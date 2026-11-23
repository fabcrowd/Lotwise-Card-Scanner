// How scan rows become contribution rows (lib/contribution.js has the schema). Pure, so the rules are testable.

import { BOX_KINDS, SIGNAL_SOURCES, detectorOf, normalizeBox, scannerOf } from "./contribution.js";
import { correctionSource } from "./draw-box.js";
import { isJaId } from "./japanese.js";
import { splitOf } from "./photo-id.js";

/**
 * What a scan keeps about one card so a later pick or confirmation can be sent: its photo, split, place in it, and the
 * scanner's own answer. It also keeps the detector's view of the box (for a box signal row); `box` is in photo pixels.
 */
export function shareFor({ photoId, box, width, height, card, kind = "found" }) {
  const normalized = normalizeBox(box, width, height);
  if (!normalized) return null;
  const share = { photoId, split: splitOf(photoId), box: normalized, scanner: scannerOf(card), ...(card?.japanese === true ? { japanese: true } : {}) };
  const detector = detectorOf({ score: card?.score, box, kind });
  return detector ? { ...share, detector } : share;
}

/** A copy of the share with the box kind replaced; the share itself when it has no detector or the kind is not one. */
export function withBoxKind(share, kind) {
  if (!share?.detector || !BOX_KINDS.includes(kind)) return share;
  return { ...share, detector: { ...share.detector, kind } };
}

/**
 * One box signal row (drawn, removed, put back). A drawn box the user then picked a card for answers that card. Null when it cannot be built.
 * A Japanese card is never shared as a card answer; box rows (drawn, removed, put back) are still sent without a card id:
 * a flagged or `jp-` row answers "unknown" and its scanner guess is blank.
 */
export function signalRow({ share, crop, source, pickedId = null }) {
  if (!share?.detector || !crop || !SIGNAL_SOURCES.includes(source)) return null;
  const japanese = share.japanese === true || isJaId(share.scanner?.cardId) || isJaId(pickedId);
  const answer = !japanese && source === "drawn" && typeof pickedId === "string" && pickedId ? { cardId: pickedId } : { unknown: true };
  const scanner = japanese ? { cardId: null, confidence: share.scanner?.confidence ?? 0, stripe: "none" } : share.scanner;
  return { box: share.box, crop, answer, scanner, source, detector: share.detector };
}

/** What a box signal (drawn, removed, put back) needs: its teach-split share with a detector and a picture. Null otherwise. */
export function boxSignalSource(scan, msg) {
  if (!SIGNAL_SOURCES.includes(msg?.source)) return null;
  const { share, crop } = correctionSource(scan, msg);
  if (!share || share.split !== "teach" || !share.detector || typeof crop !== "string" || !crop) return null;
  return { share, crop };
}

/**
 * A drawn, removed or put-back box as its own one-card contribution. `scan` is an async function returning the stored scan
 * (called only once sharing is on); `shrink` makes the sent picture and gives null when none fits.
 * False when nothing is sent, otherwise what `sharing.contribute` gave back.
 */
export async function contributeSignal({ sharing, scan, msg, shrink }) {
  if (!(await sharing.enabled())) return false;
  const found = boxSignalSource(await scan(), msg);
  if (!found) return false;
  const crop = await shrink(found.crop);
  if (!crop) return false;
  const row = signalRow({ share: found.share, crop, source: msg.source });
  if (!row) return false;
  return sharing.contribute({ photoId: found.share.photoId, cards: [row] });
}

/** One picker pick or "Wrong card?" fix on a teach photo. */
export function teachRow({ share, crop, pickedId, via }) {
  return { box: share.box, crop, answer: { cardId: pickedId }, scanner: share.scanner, source: via === "wrong-card" ? "wrong-card" : "pick" };
}

/** photoId -> card indices, for the exam photos of a scan, in order. */
export function examGroups(shares) {
  const groups = new Map();
  (shares || []).forEach((share, index) => {
    if (share?.split !== "exam") return;
    if (!groups.has(share.photoId)) groups.set(share.photoId, []);
    groups.get(share.photoId).push(index);
  });
  return groups;
}

export const wantsExamPrompt = (shares) => examGroups(shares).size > 0;

/**
 * Every row of one exam photo. A fix the user made wins; otherwise the popup's own displayed answer is confirmed
 * (a card id the catalog does not know, or nothing, is "unknown"). Null when any row has no picture, because an
 * exam contribution must hold every row of its photo. Also null when any box of the photo is Japanese (flagged, shown
 * as a Japanese card, or picked as one): a Japanese card is never shared as a card answer; box rows (drawn, removed, put back) are still sent without a card id.
 * A partial photo would break the contract, so the whole exam photo is dropped.
 * @param picks index -> { cardId, source }
 * @param displayed index -> { cardId } | { notACard: true } | { unknown: true } | { japanese: true }
 */
export function examRows({ shares, indices, crops, picks, displayed, known }) {
  const rows = [];
  for (const index of indices) {
    const crop = crops[index];
    if (!crop) return null;
    const pick = picks[index];
    const shown = displayed[index];
    if (shown?.japanese === true || isJaId(shown?.cardId) || isJaId(pick?.cardId)) return null;
    let answer = { unknown: true };
    let source = "confirm";
    if (pick) {
      answer = { cardId: pick.cardId };
      source = pick.source;
    } else if (shown?.notACard === true) {
      answer = { notACard: true };
    } else if (typeof shown?.cardId === "string" && known(shown.cardId)) {
      answer = { cardId: shown.cardId };
    }
    rows.push({ box: shares[index].box, crop, answer, scanner: shares[index].scanner, source });
  }
  return rows;
}
