// Soft-gate license: newest-set catalog extras need an active key. Core scanning stays free.
// Pure helpers are tested without chrome; storage and fetch are injected.

export const LICENSE_STORAGE_KEY = "lotwiseLicense";
export const LICENSE_INSTALL_ID_KEY = "lotwiseLicenseInstallId";
export const LICENSE_GATE_NOTE_KEY = "licenseGateNote";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_KEY_HINT = "LOTWISE-TRIAL";

/** @param {unknown} raw */
export function normalizeKey(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** UUID v4-ish id for license binding (not the sharing id). */
export function newInstallId(randomUUID = () => crypto.randomUUID()) {
  return randomUUID();
}

/**
 * Cached entitlement is active when status is active and checked within 24h.
 * @param {{ status?: string, checkedAt?: number } | null | undefined} cache
 * @param {number} [now]
 */
export function isLicenseActive(cache, now = Date.now()) {
  if (!cache || cache.status !== "active") return false;
  if (!Number.isFinite(cache.checkedAt)) return false;
  return now - cache.checkedAt < DAY_MS;
}

export function licenseStatusLabel(cache, now = Date.now()) {
  if (!cache || !cache.status || cache.status === "none") return "No license — newest sets stay locked until you activate a key.";
  if (cache.status === "revoked") return "License revoked. Newest sets are locked; core scanning still works.";
  if (cache.status === "invalid") return "That key is not valid.";
  if (cache.status === "active") {
    if (isLicenseActive(cache, now)) {
      const plan = cache.plan === "trial" ? "Trial" : "Licensed";
      return `${plan}: newest sets unlocked.`;
    }
    return "License needs a refresh (Check now). Newest sets stay locked until then.";
  }
  return "No license — newest sets stay locked until you activate a key.";
}

/** Fingerprint for UI (never store the full key in logs). */
export function keyFingerprint(normalizedKey) {
  if (!normalizedKey) return "";
  if (normalizedKey.length <= 8) return normalizedKey;
  return `${normalizedKey.slice(0, 4)}…${normalizedKey.slice(-4)}`;
}

/**
 * @param {object} body server JSON
 * @param {string} normalizedKey
 * @param {number} now
 */
export function cacheFromResponse(body, normalizedKey, now = Date.now()) {
  const status = body?.status === "active" || body?.status === "revoked" || body?.status === "invalid" ? body.status : "invalid";
  return {
    status,
    plan: body?.plan === "trial" || body?.plan === "paid" ? body.plan : null,
    expiresAt: typeof body?.expiresAt === "string" ? body.expiresAt : null,
    checkedAt: now,
    key: normalizedKey,
    keyFingerprint: keyFingerprint(normalizedKey),
  };
}

export function clearedLicenseCache(prev) {
  return {
    status: "none",
    plan: null,
    expiresAt: null,
    checkedAt: Date.now(),
    key: "",
    keyFingerprint: "",
    ...(prev && typeof prev === "object" ? {} : {}),
  };
}

/**
 * Note when a pack has new cards but license is inactive.
 * @param {{ hasExtra: boolean, licenseActive: boolean, dismissed?: boolean }} state
 */
export function licenseGateNoteText({ hasExtra, licenseActive, dismissed }) {
  if (dismissed || licenseActive || !hasExtra) return null;
  return "Newest sets need a license. Open Settings → License and enter your key (trial key while Lotwise is in preview: LOTWISE-TRIAL).";
}

/** Soft gate: catalogExtra rows are used only when the license is active. */
export function selectPaidExtra(extra, licenseActive) {
  return licenseActive && extra ? extra : null;
}

/**
 * @param {{ get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<void> }} storage
 */
export async function ensureInstallId(storage, randomUUID) {
  const existing = await storage.get(LICENSE_INSTALL_ID_KEY);
  if (typeof existing === "string" && existing.length > 0) return existing;
  const id = newInstallId(randomUUID);
  await storage.set(LICENSE_INSTALL_ID_KEY, id);
  return id;
}

/**
 * @param {{ licenseUrl: string, storage: { get, set }, fetchFn?: typeof fetch, now?: () => number, randomUUID?: () => string }} opts
 */
export async function activateLicense({ licenseUrl, storage, key, fetchFn = fetch, now = Date.now, randomUUID }) {
  if (!licenseUrl) return { ok: false, cache: await storage.get(LICENSE_STORAGE_KEY), error: "license server not configured" };
  const normalized = normalizeKey(key);
  if (!normalized) return { ok: false, cache: await storage.get(LICENSE_STORAGE_KEY), error: "enter a key" };
  const installId = await ensureInstallId(storage, randomUUID);
  const res = await fetchFn(`${licenseUrl.replace(/\/$/, "")}/v1/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: normalized, installId }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    return { ok: false, cache: await storage.get(LICENSE_STORAGE_KEY), error: "could not reach the license server" };
  }
  const cache = cacheFromResponse(body, normalized, now());
  await storage.set(LICENSE_STORAGE_KEY, cache);
  return { ok: cache.status === "active", cache };
}

export async function checkLicense({ licenseUrl, storage, fetchFn = fetch, now = Date.now, randomUUID, force = false }) {
  const prev = (await storage.get(LICENSE_STORAGE_KEY)) || null;
  if (!licenseUrl) return { ok: false, cache: prev, error: "license server not configured" };
  if (!force && isLicenseActive(prev, now())) return { ok: true, cache: prev, skipped: true };
  const normalized = normalizeKey(prev?.key);
  if (!normalized) {
    const empty = { status: "none", plan: null, expiresAt: null, checkedAt: now(), key: "", keyFingerprint: "" };
    await storage.set(LICENSE_STORAGE_KEY, empty);
    return { ok: false, cache: empty };
  }
  const installId = await ensureInstallId(storage, randomUUID);
  let body;
  try {
    const res = await fetchFn(`${licenseUrl.replace(/\/$/, "")}/v1/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: normalized, installId }),
    });
    body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error("bad response");
  } catch {
    // Soft fail: keep previous cache; caller treats inactive/expired as no extras.
    return { ok: false, cache: prev, offline: true };
  }
  const cache = cacheFromResponse(body, normalized, now());
  await storage.set(LICENSE_STORAGE_KEY, cache);
  return { ok: cache.status === "active", cache };
}
