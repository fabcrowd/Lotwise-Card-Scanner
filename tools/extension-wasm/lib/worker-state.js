// State the service worker keeps across its idle stops (chrome.storage.session): draw mode (the tab and era) and the
// finished scan result it holds for a page. Card crops are not kept (pictures are large; the popup's saved lot has its own
// thumbnails), and a result over the cap is not kept at all. Every function degrades to "nothing saved"; none throws.

const DRAW_KEY = "drawState";
const HELD_KEY = "heldScan";
export const HELD_CAP_BYTES = 2 * 1024 * 1024;
// Session storage outlives the worker (until the browser closes), so a held result must not look current for hours: prices and rows go stale.
export const HELD_SCAN_MAX_AGE_MS = 30 * 60 * 1000;

/** The value a restarted worker ends up with: the stored one only when nothing set the state since the worker started (a set to null counts). */
export function pickRestored(touched, current, stored) {
  return touched ? current : stored;
}

/** Runs the restore and always resolves: a failure is logged in one line and the worker carries on with empty state. */
export async function settleRestore(task, warn = console.warn) {
  try {
    await task();
  } catch (err) {
    warn(`[BG] restoring the worker state failed: ${err?.message || err}`);
  }
}

export async function saveDrawState(session, state) {
  try {
    if (state) await session.set({ [DRAW_KEY]: { tabId: state.tabId, eraId: state.eraId ?? null } });
    else await session.remove(DRAW_KEY);
  } catch { /* the in-memory copy still works until the worker stops */ }
}

/** { tabId, eraId } while draw mode was on, else null. */
export async function loadDrawState(session) {
  try {
    const raw = (await session.get(DRAW_KEY))?.[DRAW_KEY];
    return Number.isInteger(raw?.tabId) ? { tabId: raw.tabId, eraId: typeof raw.eraId === "string" ? raw.eraId : null } : null;
  } catch {
    return null;
  }
}

/** The scan result without the card pictures. */
export function heldForStorage(data) {
  return { ...data, cards: (data.cards || []).map((card) => ({ ...card, crop: null })) };
}

export async function clearHeldScan(session) {
  try { await session.remove(HELD_KEY); } catch { /* nothing to clear */ }
}

/** Keeps a finished scan ({ data, url, finishedAt }); a scan with no data, or one over the cap, removes the old record instead. */
export async function saveHeldScan(session, held) {
  try {
    if (!held?.data) return await clearHeldScan(session);
    const record = { data: heldForStorage(held.data), url: held.url ?? null, finishedAt: held.finishedAt };
    if (JSON.stringify(record).length > HELD_CAP_BYTES) return await clearHeldScan(session);
    await session.set({ [HELD_KEY]: record });
  } catch { /* the in-memory copy still works until the worker stops */ }
}

/** { data, url, finishedAt } of the last finished scan, or null. One without a usable time, or older than HELD_SCAN_MAX_AGE_MS, is removed. */
export async function loadHeldScan(session, now = () => Date.now()) {
  try {
    const raw = (await session.get(HELD_KEY))?.[HELD_KEY];
    if (!raw) return null;
    const age = Number.isFinite(raw.finishedAt) ? now() - raw.finishedAt : NaN;
    if (!(age >= -60_000 && age < HELD_SCAN_MAX_AGE_MS)) {
      await clearHeldScan(session);
      return null;
    }
    return raw.data && Array.isArray(raw.data.cards) ? { data: raw.data, url: raw.url ?? null, finishedAt: raw.finishedAt } : null;
  } catch {
    return null;
  }
}
