// "Can't price this": the user's own way out for a card the English catalog cannot name (another language, a fan
// card, merchandise). A skipped card keeps all its scan data in the list but is no longer a card to price: it is not
// counted, exported or shown with a name. The skip is stored locally as a correction row of type "skip" with the
// crop's embedding, so a similar crop on a later scan is never confirmed on its own (it stays Choose, nothing is
// skipped for the user). Local only: skips are never sent for shared learning.

import { correctionRecord } from "./card-picker.js";
import { EMBEDDING_VERSION } from "./embed.js";
import { BAR_EPSILON, referenceBar } from "./reference-bars.js";

/** pickedId of a skip row, and of the row that replaces it when the user puts the card back. Neither is a catalog id. */
export const SKIP_ID = "skip";
export const UNSKIP_ID = "unskipped";

const EMBEDDING_DIM = 512;

/** True for a stored skip (a correction row, head or reference row whose answer is the skip marker). */
export const isSkipRow = (row) => row?.pickedId === SKIP_ID || row?.cardId === SKIP_ID;

export const skipCard = (card) => ({ ...card, skipped: true });

/**
 * The user took this card out of the scan (the X on the page or in the list). It is a skip that teaches the skip memory nothing (a box signal may be shared):
 * `skipped` makes every existing exclusion apply (totals, export, to confirm), `removed` says why and keeps it out of
 * the skip memory. A card already skipped is marked so put back returns it to skipped.
 */
export function removeCard(card) {
  if (card?.removed === true) return card;
  return { ...card, skipped: true, removed: true, ...(card?.skipped === true ? { removedFromSkipped: true } : {}) };
}

export function putBackCard(card) {
  const next = { ...card };
  if (next.removed === true) {
    delete next.removed;
    if (next.removedFromSkipped === true) delete next.removedFromSkipped;
    else delete next.skipped;
    return next;
  }
  delete next.skipped;
  return next;
}

export const removedCount = (cards) => (cards || []).filter((card) => card?.removed === true).length;

/** What the left-out cards are called, skipped or removed: "Left out", as the bottom group says. */
export function leftOutLabel() {
  return "Left out";
}

export const skippedCount = (cards) => (cards || []).filter((card) => card?.skipped === true).length;

/** The sentence that says what an export leaves out, or "" when no card is skipped or removed. */
export function skipNote(count, removed = 0) {
  const total = count + removed;
  if (!(total > 0)) return "";
  const noun = (n, word) => `${n} ${word} ${n === 1 ? "card" : "cards"}`;
  const parts = [count > 0 ? noun(count, "skipped") : "", removed > 0 ? noun(removed, "removed") : ""].filter(Boolean);
  return `${parts.join(" and ")} ${total === 1 ? "is" : "are"} not included`;
}

/** The correction record for a skip: what the scanner believed (why, guess) and the crop, kept like any correction. */
export function skipDraft({ ts, scanId, index, pageUrl, guess, crop, extVersion, why }) {
  return correctionRecord({ ts, scanId, index, pageUrl, guess, pickedId: SKIP_ID, via: "skip", crop, extVersion, why, type: "skip" });
}

/** Put back: replaces the skip on the same crop. No crop, so no reference is made; the skip stays in the row's history. */
export function unskipDraft({ ts, scanId, index, pageUrl, extVersion }) {
  return correctionRecord({ ts, scanId, index, pageUrl, pickedId: UNSKIP_ID, via: "unskip", crop: null, extVersion, type: "skip" });
}

/**
 * The skipped crop this new crop resembles: a current-version skip reference at or above the boost bar of the new
 * crop's read height (lib/reference-bars.js). Null under 100 px, with no skip rows, or below the bar.
 * @returns {{score: number, refId: string, ts: number|null}|null}
 */
export function skipHit(query, rows, { height = 0 } = {}) {
  const bar = referenceBar(height);
  if (!bar) return null;
  let best = null;
  for (const ref of rows || []) {
    const vec = ref.embedding;
    if (ref.cardId !== SKIP_ID || (ref.v ?? 1) !== EMBEDDING_VERSION || !vec || vec.length !== EMBEDDING_DIM) continue;
    let dot = 0;
    for (let d = 0; d < EMBEDDING_DIM; d++) dot += query[d] * vec[d];
    dot *= ref.scale ?? 1;
    if (!Number.isFinite(dot) || dot + BAR_EPSILON < bar.boost) continue;
    if (!best || dot > best.score) best = { score: dot, refId: ref.id, ts: ref.ts ?? null };
  }
  return best;
}
