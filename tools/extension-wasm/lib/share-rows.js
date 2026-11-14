// How scan rows become contribution rows (lib/contribution.js has the schema). Pure, so the rules are testable.

import { BOX_KINDS, SIGNAL_SOURCES, detectorOf, normalizeBox, scannerOf } from "./contribution.js";
import { correctionSource } from "./draw-box.js";
import { splitOf } from "./photo-id.js";

/**
 * What a scan keeps about one card so a later pick or confirmation can be sent: its photo, split, place in it, and the
 * scanner's own answer. It also keeps the detector's view of the box (for a box signal row); `box` is in photo pixels.
 */
export function shareFor({ photoId, box, width, height, card, kind = "found" }) {
  const normalized = normalizeBox(box, width, height);
  if (!normalized) return null;
  const share = { photoId, split: splitOf(photoId), box: normalized, scanner: scannerOf(card) };
  const detector = detectorOf({ score: card?.score, box, kind });
  return detector ? { ...share, detector } : share;
}

/** A copy of the share with the box kind replaced; the share itself when it has no detector or the kind is not one. */
export function withBoxKind(share, kind) {
  if (!share?.detector || !BOX_KINDS.includes(kind)) return share;
  return { ...share, detector: { ...share.detector, kind } };
}

/** One box signal row (drawn, removed, put back). A drawn box the user then picked a card for answers that card. Null when it cannot be built. */
export function signalRow({ share, crop, source, pickedId = null }) {
  if (!share?.detector || !crop || !SIGNAL_SOURCES.includes(source)) return null;
  const answer = source === "drawn" && typeof pickedId === "string" && pickedId ? { cardId: pickedId } : { unknown: true };
  return { box: share.box, crop, answer, scanner: share.scanner, source, detector: share.detector };
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
 * exam contribution must hold every row of its photo.
 * @param picks index -> { cardId, source }
 * @param displayed index -> { cardId } | { notACard: true } | { unknown: true }
 */
export function examRows({ shares, indices, crops, picks, displayed, known }) {
  const rows = [];
  for (const index of indices) {
    const crop = crops[index];
    if (!crop) return null;
    const pick = picks[index];
    const shown = displayed[index];
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
