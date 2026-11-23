// Rules for an installed copy of the extension that notices newer files on disk and restarts itself. Pure: no chrome
// globals, no timers; the worker passes everything in. The installer's copy has a fixed manifest key, so only that id acts.

export const INSTALLER_EXTENSION_ID = "gppkiedgglhgagfmcnfebiccpkifbncm";
export const SELF_UPDATE_KEY = "selfUpdate";
// Never reload twice within this time, whatever the target version.
export const RELOAD_MIN_GAP_MS = 60_000;

export const isInstallerCopy = (runtimeId) => runtimeId === INSTALLER_EXTENSION_ID;

const MAX_PART = 65535;

/**
 * Chrome's rule for extension versions: 1 to 4 dot-separated integers, each 0..65535. Leading zeros, signs, spaces and
 * any other text are rejected (Chrome rejects them too). Returns four numbers (missing parts are 0), or null.
 */
export function parseVersion(text) {
  if (typeof text !== "string" || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(text)) return null;
  const parts = text.split(".").map(Number);
  if (parts.some((n) => n > MAX_PART)) return null;
  while (parts.length < 4) parts.push(0);
  return parts;
}

/** -1, 0 or 1; null when either version is invalid. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** True only when `disk` is strictly newer than `running`; invalid input is never newer. */
export const isNewerVersion = (disk, running) => compareVersions(disk, running) === 1;

/** A manifest read from disk that can be trusted to be a whole, runnable extension. */
export function isUsableManifest(manifest) {
  return Boolean(manifest) && typeof manifest === "object" && !Array.isArray(manifest)
    && manifest.manifest_version === 3
    && parseVersion(manifest.version) !== null
    && typeof manifest.background?.service_worker === "string" && manifest.background.service_worker.length > 0;
}

/**
 * "none" (nothing newer on disk, or the disk copy is unusable), "reload" (restart now, loses nothing), or "notice"
 * (tell the user). `guard` is the stored record: { reload: { from, to, at, reopen }, lastReloadAt, updatedTo }.
 */
export function decideSelfUpdate({ runningVersion, diskManifest, idle, guard, now }) {
  if (!isUsableManifest(diskManifest) || !isNewerVersion(diskManifest.version, runningVersion)) return "none";
  const attempted = guard && typeof guard === "object" ? guard.reload : null;
  if (attempted && typeof attempted === "object" && compareVersions(attempted.to, diskManifest.version) === 0) return "notice";
  // A time in the future (the clock moved back) is "no recent reload", as it is for the release check.
  const past = (time) => (Number.isFinite(time) && time <= now ? time : -Infinity);
  const last = Math.max(past(guard?.lastReloadAt), past(attempted?.at));
  if (now - last < RELOAD_MIN_GAP_MS) return "notice";
  return idle ? "reload" : "notice";
}

/**
 * Whether the worker may restart the extension without anyone noticing. Idle means: no message or click reached the worker
 * since it started (`activity`), no page of this extension is open (`openContextCount`, any document: scanner, Settings,
 * anything), no scanner window is known (`popupWinId`), no scan is running, draw mode is off, and nothing is stored that a
 * reload would lose. A value that is not exactly "nothing" (unknown, undefined) counts as not idle.
 */
export function workerIsIdle(state) {
  if (!state || typeof state !== "object") return false;
  return state.activity === false && state.openContextCount === 0 && (state.popupWinId ?? null) === null
    && state.scanRunning === false && state.drawActive === false && state.storedWork === false;
}

/** The one-time "was updated" note is used up only when the scanner will show it: not while a newer copy waits on disk. */
export function clearsUpdatedNote(updatedTo, diskVersion) {
  return typeof updatedTo === "string" && updatedTo.length > 0 && !diskVersion;
}

// The most the self-update waits for the start-up upload flush (its fetch has no timeout of its own).
export const FLUSH_WAIT_MAX_MS = 15_000;

/** Resolves true when `promise` settles (resolved or rejected) within `maxMs`, false when the time is up first. Never rejects. */
export function waitSettled(promise, maxMs, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolve) => {
    const timer = setTimer(() => resolve(false), maxMs);
    Promise.resolve(promise).then(() => true, () => true).then((settled) => {
      clearTimer(timer);
      resolve(settled);
    });
  });
}

/** The guard to store just before a reload. Keeps the other fields (a pending updatedTo note). */
export function guardWithReload(guard, { from, to, at, reopen }) {
  const base = guard && typeof guard === "object" ? guard : {};
  return { ...base, reload: { from, to, at, reopen: reopen === true }, lastReloadAt: at };
}

/**
 * At worker start: when the running version is the one a reload aimed at, the reload worked. The reload entry goes, the
 * time of the reload stays (for the 60 s rule) and `updatedTo` is kept for a one-time note. Otherwise the record is kept
 * as it is, so the same target is never tried again.
 */
export function settleAfterReload(guard, runningVersion) {
  const reload = guard && typeof guard === "object" ? guard.reload : null;
  if (!reload || compareVersions(reload.to, runningVersion) !== 0) return { succeeded: false, reopen: false, guard };
  const next = { ...guard, updatedTo: reload.to, lastReloadAt: reload.at };
  delete next.reload;
  return { succeeded: true, reopen: reload.reopen === true, guard: next };
}

// What chrome.storage.session keeps that a reload clears (lib/worker-state.js: draw mode and the held scan;
// lib/lot-session.js: saved lots). The key names are repeated here so this module imports nothing.
const HELD_KEY = "heldScan";
const DRAW_KEY = "drawState";
const LOTS_KEY = "lotSessions";

// ─── the check for a newer release ───
// A small file on a fixed GitHub release says which installer is the newest. Nothing is downloaded or run from it, and no
// address shown to or opened for the user comes from it: the page to open is RELEASE_PAGE_URL, fixed here.

export const VERSION_FILE_URL = "https://github.com/fabcrowd/pokemon-auto-lister/releases/download/installer/lotwise-version.json";
export const RELEASE_PAGE_URL = "https://github.com/fabcrowd/pokemon-auto-lister/releases/tag/installer";
export const RELEASE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RELEASE_CHECK_MIN_GAP_MS = 60_000;
export const VERSION_FILE_MAX_BYTES = 2048;
const RELEASE_CHECK_TIMEOUT_MS = 10_000;
const RELEASE_REPO_DOWNLOADS = "/fabcrowd/pokemon-auto-lister/releases/download/";
// Where a release download may end: the repository's own release path, or the two hosts GitHub redirects it to. These are
// the release hosts of STORE_HOSTS in scripts/lib/store-package.mjs (a test keeps the two lists together).
export const RELEASE_FINAL_HOSTS = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

/** The version in the release's version file, or null for anything that is not exactly such a file. */
export function parseVersionFile(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > VERSION_FILE_MAX_BYTES) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.product !== "Lotwise") return null;
  return parseVersion(data.version) === null ? null : data.version;
}

/** Due when no check was made, the last one was 24 h or more ago, or the stored time is in the future. */
export function releaseCheckDue(lastCheckAt, now) {
  return !Number.isFinite(lastCheckAt) || lastCheckAt > now || now - lastCheckAt >= RELEASE_CHECK_INTERVAL_MS;
}

/** The manual "Check now" waits RELEASE_CHECK_MIN_GAP_MS after any check; a stored time in the future does not block it. */
export function manualCheckAllowed(lastCheckAt, now) {
  return !Number.isFinite(lastCheckAt) || lastCheckAt > now || now - lastCheckAt >= RELEASE_CHECK_MIN_GAP_MS;
}

/** The newest version to offer: strictly newer than the running one and the one on disk, and not the one dismissed. Else null. */
export function availableUpdate({ latestVersion, runningVersion, diskVersion, dismissedVersion }) {
  if (!isNewerVersion(latestVersion, runningVersion)) return null;
  if (diskVersion && !isNewerVersion(latestVersion, diskVersion)) return null;
  if (dismissedVersion && compareVersions(latestVersion, dismissedVersion) === 0) return null;
  return latestVersion;
}

/** Whether a fetch that ended on this address came from the release download: https, no credentials, an allowed host. */
export function releaseUrlAllowed(finalUrl) {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (!RELEASE_FINAL_HOSTS.includes(url.hostname)) return false;
  return url.hostname !== "github.com" || url.pathname.startsWith(RELEASE_REPO_DOWNLOADS);
}

// The body as text, read in pieces so a response that lies about (or omits) its length is cut off at the cap. Null when over it.
async function readCappedText(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel?.(); } catch { /* the body is dropped either way */ }
    return null;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

async function fetchLatestVersion(fetchFn) {
  const response = await fetchFn(VERSION_FILE_URL, {
    cache: "no-store", credentials: "omit", redirect: "follow", signal: AbortSignal.timeout(RELEASE_CHECK_TIMEOUT_MS),
  });
  if (!response.ok || !releaseUrlAllowed(response.url)) return null;
  const text = await readCappedText(response, VERSION_FILE_MAX_BYTES);
  return text === null ? null : parseVersionFile(text);
}

/**
 * One check. The attempt time is saved before the request, so a failed check also waits for the next due time. `save(fields)`
 * stores just those fields; `guard` is the record as read. Resolves { ok, guard } with the record as it now stands: a valid
 * file sets latestVersion, every failure leaves the previous one. Never throws.
 */
export async function checkForRelease({ guard, fetchFn, now, save }) {
  let next = { ...(guard && typeof guard === "object" ? guard : {}), lastCheckAt: now() };
  const persist = async (fields) => {
    next = { ...next, ...fields };
    try { await save(fields); } catch { /* the check still runs; the record is rebuilt at the next one */ }
  };
  await persist({ lastCheckAt: next.lastCheckAt });
  let latest = null;
  try {
    latest = await fetchLatestVersion(fetchFn);
  } catch {
    latest = null;
  }
  if (latest === null) {
    await persist({ lastCheckOk: false });
    return { ok: false, guard: next };
  }
  await persist({ lastCheckOk: true, latestVersion: latest });
  return { ok: true, guard: next };
}

/** True when a reload would lose something. An unreadable store counts as "yes": nothing is risked on a guess. */
export async function hasStoredSessionWork(session) {
  try {
    const stored = await session.get([HELD_KEY, DRAW_KEY, LOTS_KEY]);
    if (stored?.[HELD_KEY] || stored?.[DRAW_KEY]) return true;
    const lots = stored?.[LOTS_KEY]?.lots;
    return Boolean(lots) && typeof lots === "object" && Object.keys(lots).length > 0;
  } catch {
    return true;
  }
}
