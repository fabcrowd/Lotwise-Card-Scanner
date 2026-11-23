import { readConfig } from "./config.js";
import {
  hashKey,
  installRecordKey,
  loadOrSeedKey,
  normalizeKey,
  parseRecord,
  replyBody,
  saveKey,
  keyRecordKey,
} from "./keys.js";

export const MAX_BODY_BYTES = 4096;
const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cors(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-lotwise-admin",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function reply(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers,
    },
  });
}

function allowedOrigin(request, config) {
  const origin = request.headers.get("origin");
  const match = origin && /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  return match && config.allowedExtensionIds.includes(match[1]) ? origin : null;
}

async function readCapped(request, cap) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJsonBody(text) {
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function validInstallId(id) {
  return typeof id === "string" && INSTALL_ID_RE.test(id);
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {{ now?: () => Date }} [deps]
 */
export async function handleRequest(request, env, deps = {}) {
  let config;
  try {
    config = readConfig(env);
  } catch (err) {
    return reply(500, { error: err.message || "config" });
  }

  const url = new URL(request.url);
  const origin = allowedOrigin(request, config);
  const headers = cors(origin || "*");

  if (request.method === "OPTIONS") {
    return reply(204, null, headers);
  }

  if (request.method !== "POST") {
    return reply(405, { error: "method not allowed" }, headers);
  }

  // Admin routes do not require a chrome-extension Origin.
  if (url.pathname === "/v1/admin/keys" || url.pathname === "/v1/admin/revoke") {
    return handleAdmin(request, config, url.pathname, headers);
  }

  if (!origin) {
    return reply(403, { error: "origin not allowed" }, headers);
  }

  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return reply(413, { error: "body too large" }, headers);
  const body = parseJsonBody(raw);
  if (!body) return reply(400, { error: "invalid json" }, headers);

  if (url.pathname === "/v1/activate") {
    return activate(body, config, headers);
  }
  if (url.pathname === "/v1/check") {
    return check(body, config, headers);
  }
  return reply(404, { error: "not found" }, headers);
}

async function activate(body, config, headers) {
  const key = normalizeKey(body.key);
  const installId = body.installId;
  if (!key || key.length > 128) return reply(400, { error: "key required" }, headers);
  if (!validInstallId(installId)) return reply(400, { error: "installId required" }, headers);

  const keyHash = await hashKey(key);
  const record = await loadOrSeedKey(config, keyHash);
  if (!record) return reply(200, { status: "invalid" }, headers);
  if (record.revoked) return reply(200, replyBody(record, "revoked"), headers);

  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return reply(200, { status: "invalid", plan: record.plan }, headers);
  }

  if (!record.activations.includes(installId)) {
    if (record.activations.length >= record.maxActivations) {
      return reply(200, { status: "invalid", plan: record.plan, error: "activation cap reached" }, headers);
    }
    record.activations.push(installId);
    await saveKey(config, record);
  }
  await config.kv.put(installRecordKey(installId), JSON.stringify({ keyHash: record.keyHash, at: new Date().toISOString() }));
  return reply(200, replyBody(record, "active"), headers);
}

async function check(body, config, headers) {
  const key = normalizeKey(body.key);
  const installId = body.installId;
  if (!key || key.length > 128) return reply(400, { error: "key required" }, headers);
  if (!validInstallId(installId)) return reply(400, { error: "installId required" }, headers);

  const keyHash = await hashKey(key);
  const record = await loadOrSeedKey(config, keyHash);
  if (!record) return reply(200, { status: "invalid" }, headers);
  if (record.revoked) return reply(200, replyBody(record, "revoked"), headers);

  let boundHash = null;
  try {
    const raw = await config.kv.get(installRecordKey(installId));
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data.keyHash === "string") boundHash = data.keyHash;
    }
  } catch {
    boundHash = null;
  }
  if (boundHash !== keyHash || !record.activations.includes(installId)) {
    return reply(200, { status: "invalid", plan: record.plan }, headers);
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return reply(200, { status: "invalid", plan: record.plan }, headers);
  }
  return reply(200, replyBody(record, "active"), headers);
}

async function handleAdmin(request, config, pathname, headers) {
  if (!config.adminSecret || request.headers.get("x-lotwise-admin") !== config.adminSecret) {
    return reply(401, { error: "unauthorized" }, headers);
  }
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return reply(413, { error: "body too large" }, headers);
  const body = parseJsonBody(raw);
  if (!body) return reply(400, { error: "invalid json" }, headers);

  if (pathname === "/v1/admin/keys") {
    const key = normalizeKey(body.key);
    if (!key || key.length > 128) return reply(400, { error: "key required" }, headers);
    const plan = body.plan === "trial" ? "trial" : "paid";
    const maxActivations = Number.isInteger(body.maxActivations) && body.maxActivations > 0
      ? body.maxActivations
      : config.defaultMaxActivations;
    const keyHash = await hashKey(key);
    const existing = parseRecord(await config.kv.get(keyRecordKey(keyHash)));
    const record = {
      keyHash,
      plan,
      revoked: false,
      maxActivations,
      activations: existing?.activations ?? [],
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    };
    await saveKey(config, record);
    return reply(200, { ok: true, keyHash, plan, maxActivations, activations: record.activations.length }, headers);
  }

  if (pathname === "/v1/admin/revoke") {
    const key = normalizeKey(body.key);
    if (!key) return reply(400, { error: "key required" }, headers);
    const keyHash = await hashKey(key);
    const record = parseRecord(await config.kv.get(keyRecordKey(keyHash)));
    if (!record) return reply(404, { error: "unknown key" }, headers);
    record.revoked = true;
    await saveKey(config, record);
    return reply(200, { ok: true, keyHash, revoked: true }, headers);
  }

  return reply(404, { error: "not found" }, headers);
}
