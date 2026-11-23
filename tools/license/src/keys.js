// Key records in KV. Raw license strings are never stored; only sha256 hex digests.

export const keyRecordKey = (keyHash) => `key:${keyHash}`;
export const installRecordKey = (installId) => `install:${installId}`;

/** Normalize user-entered key text. */
export function normalizeKey(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** SHA-256 hex of the normalized key (Web Crypto). */
export async function hashKey(normalized) {
  const bytes = new TextEncoder().encode(normalized);
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseRecord(raw) {
  if (!raw) return null;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") return null;
    if (typeof data.keyHash !== "string" || !/^[0-9a-f]{64}$/.test(data.keyHash)) return null;
    if (data.plan !== "trial" && data.plan !== "paid") return null;
    if (typeof data.revoked !== "boolean") return null;
    if (!Number.isInteger(data.maxActivations) || data.maxActivations < 1) return null;
    if (!Array.isArray(data.activations)) return null;
    return {
      keyHash: data.keyHash,
      plan: data.plan,
      revoked: data.revoked,
      maxActivations: data.maxActivations,
      activations: data.activations.filter((id) => typeof id === "string" && id.length > 0),
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
    };
  } catch {
    return null;
  }
}

export function replyBody(record, statusOverride) {
  const status = statusOverride || (record.revoked ? "revoked" : "active");
  const body = { status, plan: record.plan };
  if (record.expiresAt) body.expiresAt = record.expiresAt;
  return body;
}

/**
 * Load a key record, creating the seeded trial key on first sight of its hash.
 * @param {{ kv: KVNamespace, trialKeyHash: string, trialMaxActivations: number }} config
 */
export async function loadOrSeedKey(config, keyHash) {
  const stored = parseRecord(await config.kv.get(keyRecordKey(keyHash)));
  if (stored) return stored;
  if (keyHash !== config.trialKeyHash) return null;
  const trial = {
    keyHash,
    plan: "trial",
    revoked: false,
    maxActivations: config.trialMaxActivations,
    activations: [],
    expiresAt: null,
  };
  await config.kv.put(keyRecordKey(keyHash), JSON.stringify(trial));
  return trial;
}

export async function saveKey(config, record) {
  await config.kv.put(keyRecordKey(record.keyHash), JSON.stringify(record));
}
