/* global Request */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleRequest } from "../tools/license/src/handler.js";
import { fakeKV } from "../tools/relay/test/fakes.js";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXT}`;
const TRIAL = "LOTWISE-TRIAL";
const TRIAL_HASH = createHash("sha256").update(TRIAL, "utf8").digest("hex");
const INSTALL = "11111111-1111-4111-8111-111111111111";
const INSTALL2 = "22222222-2222-4222-8222-222222222222";

function setup(over = {}) {
  const env = {
    ALLOWED_EXTENSION_IDS: EXT,
    TRIAL_KEY_HASH: TRIAL_HASH,
    TRIAL_MAX_ACTIVATIONS: "2",
    DEFAULT_MAX_ACTIVATIONS: "5",
    LICENSE_ADMIN_SECRET: "admin-secret",
    KEYS: fakeKV(),
    ...over,
  };
  return { env };
}

const post = (path, body, { origin = ORIGIN, headers = {} } = {}) =>
  new Request(`https://license.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...headers },
    body: JSON.stringify(body),
  });

test("activate seeds the trial key and binds the install", async () => {
  const { env } = setup();
  const res = await handleRequest(post("/v1/activate", { key: TRIAL, installId: INSTALL }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "active", plan: "trial" });
  const stored = JSON.parse(env.KEYS.map.get(`key:${TRIAL_HASH}`));
  assert.equal(stored.plan, "trial");
  assert.deepEqual(stored.activations, [INSTALL]);
});

test("check requires the install to be bound to the key", async () => {
  const { env } = setup();
  await handleRequest(post("/v1/activate", { key: TRIAL, installId: INSTALL }), env);
  const ok = await handleRequest(post("/v1/check", { key: TRIAL, installId: INSTALL }), env);
  assert.deepEqual(await ok.json(), { status: "active", plan: "trial" });
  const bad = await handleRequest(post("/v1/check", { key: TRIAL, installId: INSTALL2 }), env);
  assert.equal((await bad.json()).status, "invalid");
});

test("a bad key is invalid", async () => {
  const { env } = setup();
  const res = await handleRequest(post("/v1/activate", { key: "NOPE", installId: INSTALL }), env);
  assert.deepEqual(await res.json(), { status: "invalid" });
});

test("activation cap is enforced", async () => {
  const { env } = setup({ TRIAL_MAX_ACTIVATIONS: "1" });
  assert.equal((await handleRequest(post("/v1/activate", { key: TRIAL, installId: INSTALL }), env)).status, 200);
  const second = await handleRequest(post("/v1/activate", { key: TRIAL, installId: INSTALL2 }), env);
  const body = await second.json();
  assert.equal(body.status, "invalid");
  assert.match(body.error || "", /cap/i);
});

test("admin revoke makes check return revoked", async () => {
  const { env } = setup();
  await handleRequest(post("/v1/activate", { key: TRIAL, installId: INSTALL }), env);
  const revoked = await handleRequest(
    post("/v1/admin/revoke", { key: TRIAL }, { origin: null, headers: { "x-lotwise-admin": "admin-secret" } }),
    env,
  );
  assert.equal(revoked.status, 200);
  const check = await handleRequest(post("/v1/check", { key: TRIAL, installId: INSTALL }), env);
  assert.equal((await check.json()).status, "revoked");
});

test("admin create and unknown origin are gated", async () => {
  const { env } = setup();
  const denied = await handleRequest(
    post("/v1/admin/keys", { key: "PAID-1", plan: "paid" }, { origin: null, headers: { "x-lotwise-admin": "wrong" } }),
    env,
  );
  assert.equal(denied.status, 401);
  const created = await handleRequest(
    post("/v1/admin/keys", { key: "PAID-1", plan: "paid", maxActivations: 3 }, { origin: null, headers: { "x-lotwise-admin": "admin-secret" } }),
    env,
  );
  assert.equal(created.status, 200);
  const forbidden = await handleRequest(post("/v1/activate", { key: "PAID-1", installId: INSTALL }, { origin: "https://evil.example" }), env);
  assert.equal(forbidden.status, 403);
});
