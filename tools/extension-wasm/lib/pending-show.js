// A click on a card on the page opens the scanner at that card. When the click has to open the window, the card's index
// and the page's address wait here (chrome.storage.session) until the window has restored its lot; one older than the
// limit, or for another page than the lot, is ignored.

import { isSamePage } from "./draw-box.js";

export const PENDING_SHOW_KEY = "pendingShow";
export const PENDING_SHOW_MAX_AGE_MS = 10_000;

export function savePendingShow(storage, { index, url }, now = Date.now()) {
  return storage.set({ [PENDING_SHOW_KEY]: { index, url, at: now } });
}

// The page's "Open full-size photo" pill can also open the window. Its record has a kind and no index: the window applies
// it once its lot is restored (the card-index record has no kind field).
export const PENDING_FULLSIZE_KIND = "fullsize";

export function savePendingFullSize(storage, { url }, now = Date.now()) {
  return storage.set({ [PENDING_SHOW_KEY]: { kind: PENDING_FULLSIZE_KIND, url, at: now } });
}

/** Removes the waiting record (the window it was stored for could not be opened). Never throws. */
export async function clearPendingShow(storage) {
  try { await storage.remove(PENDING_SHOW_KEY); } catch { /* nothing to clear */ }
}

/** The waiting { index, url } (or { kind: "fullsize", url }), once: it is cleared as it is read, and null when there is none, it is stale or malformed. */
export async function takePendingShow(storage, now = Date.now()) {
  let pending;
  try {
    pending = (await storage.get(PENDING_SHOW_KEY))?.[PENDING_SHOW_KEY];
    if (pending !== undefined) await storage.remove(PENDING_SHOW_KEY);
  } catch {
    return null;
  }
  if (pending?.kind !== undefined) {
    if (pending.kind !== PENDING_FULLSIZE_KIND || typeof pending.url !== "string" || !Number.isFinite(pending.at)) return null;
    return now - pending.at > PENDING_SHOW_MAX_AGE_MS ? null : { kind: PENDING_FULLSIZE_KIND, url: pending.url };
  }
  if (!Number.isInteger(pending?.index) || pending.index < 0 || typeof pending.url !== "string" || !Number.isFinite(pending.at)) return null;
  return now - pending.at > PENDING_SHOW_MAX_AGE_MS ? null : { index: pending.index, url: pending.url };
}

/** The index to show: only when the click was on the page of the lot this window holds (a #hash is not another page). */
export function matchPendingShow(pending, lotUrl) {
  return pending && pending.kind === undefined && isSamePage(lotUrl, pending.url) ? pending.index : null;
}

/** Whether a waiting full-size click is for the page of the lot this window holds. */
export function matchPendingFullSize(pending, lotUrl) {
  return pending?.kind === PENDING_FULLSIZE_KIND && isSamePage(lotUrl, pending.url);
}
