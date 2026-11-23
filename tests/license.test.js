import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  activateLicense,
  cacheFromResponse,
  checkLicense,
  isLicenseActive,
  keyFingerprint,
  licenseGateNoteText,
  licenseStatusLabel,
  normalizeKey,
  selectPaidExtra,
} from "../tools/extension-wasm/lib/license.js";

test("normalizeKey trims and uppercases", () => {
  assert.equal(normalizeKey("  lotwise-trial  "), "LOTWISE-TRIAL");
});

test("isLicenseActive requires active status within 24h", () => {
  const now = 1_700_000_000_000;
  assert.equal(isLicenseActive({ status: "active", checkedAt: now }, now), true);
  assert.equal(isLicenseActive({ status: "active", checkedAt: now - DAY_MS }, now), false);
  assert.equal(isLicenseActive({ status: "revoked", checkedAt: now }, now), false);
  assert.equal(isLicenseActive(null, now), false);
});

test("selectPaidExtra soft-gates catalog extras", () => {
  const extra = { rows: new Float32Array(2), meta: [{ id: "a" }] };
  assert.equal(selectPaidExtra(extra, true), extra);
  assert.equal(selectPaidExtra(extra, false), null);
  assert.equal(selectPaidExtra(null, true), null);
});

test("licenseGateNoteText only when extras exist and license is inactive", () => {
  assert.match(licenseGateNoteText({ hasExtra: true, licenseActive: false }), /LOTWISE-TRIAL/);
  assert.equal(licenseGateNoteText({ hasExtra: true, licenseActive: true }), null);
  assert.equal(licenseGateNoteText({ hasExtra: false, licenseActive: false }), null);
  assert.equal(licenseGateNoteText({ hasExtra: true, licenseActive: false, dismissed: true }), null);
});

test("cacheFromResponse and labels", () => {
  const cache = cacheFromResponse({ status: "active", plan: "trial" }, "LOTWISE-TRIAL", 100);
  assert.equal(cache.status, "active");
  assert.equal(cache.plan, "trial");
  assert.equal(cache.keyFingerprint, keyFingerprint("LOTWISE-TRIAL"));
  assert.match(licenseStatusLabel(cache, 100), /Trial/);
  assert.match(licenseStatusLabel({ status: "revoked", checkedAt: 100 }), /revoked/i);
});

function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v); },
    map,
  };
}

test("activateLicense stores an active cache", async () => {
  const storage = memStorage();
  const fetchFn = async () =>
    new Response(JSON.stringify({ status: "active", plan: "trial" }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await activateLicense({
    licenseUrl: "https://license.example",
    storage,
    key: "lotwise-trial",
    fetchFn,
    now: () => 5000,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.ok, true);
  assert.equal(result.cache.status, "active");
  assert.equal(storage.map.get("lotwiseLicense").key, "LOTWISE-TRIAL");
});

test("checkLicense soft-fails offline and keeps the previous cache", async () => {
  const prev = { status: "active", plan: "paid", checkedAt: 1, key: "ABC", keyFingerprint: "A…C" };
  const storage = memStorage({ lotwiseLicense: prev });
  const result = await checkLicense({
    licenseUrl: "https://license.example",
    storage,
    fetchFn: async () => { throw new Error("offline"); },
    now: () => 1 + DAY_MS,
    force: true,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.offline, true);
  assert.equal(result.cache, prev);
});

test("checkLicense skips the network when the cache is still fresh", async () => {
  const now = 10_000;
  const prev = { status: "active", plan: "trial", checkedAt: now - 1000, key: "LOTWISE-TRIAL", keyFingerprint: "LOTW…RIAL" };
  const storage = memStorage({ lotwiseLicense: prev });
  let called = 0;
  const result = await checkLicense({
    licenseUrl: "https://license.example",
    storage,
    fetchFn: async () => { called += 1; throw new Error("should not run"); },
    now: () => now,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(called, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.ok, true);
});
