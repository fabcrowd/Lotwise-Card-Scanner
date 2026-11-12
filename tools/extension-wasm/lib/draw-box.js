// "Draw a box": the user marks a card the scan missed. These are the pure parts the background uses to turn the
// rectangle drawn on the page back into photo pixels, to build the entry, and to place it in the result.
// A drawn box is never shared: it carries no share record and never goes through the sharing code.

import { tooSmallCard } from "./tiny-card.js";

export const DRAWN_VIA = "drawn";
export const DRAW_HINT_TEXT = "Drag a box around the card on the page. Esc to cancel.";
/** A drawn rectangle smaller than this (CSS px, either side) is ignored. */
export const MIN_DRAW_SIDE = 12;
/** A drawn box replaces a hidden or Too small entry it overlaps at least this much (IoU). */
export const REPLACE_IOU = 0.3;

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * The inverse of mapPhotoBoxToViewport: a viewport rectangle [x1, y1, x2, y2] back to the picture's own pixels,
 * clipped to the picture (letterbox bars and a cropped-away part are not the photo). `transform` is the one the scan
 * uses (imageToViewportTransform, rescaled for an upgraded source) and `size` the pixel size of the picture it maps.
 * Null when nothing of the rectangle is on the picture.
 */
export function viewportToPhotoBox(rect, transform, size) {
  if (!Array.isArray(rect) || rect.length !== 4 || !transform || !(transform.scaleX > 0) || !(transform.scaleY > 0)) return null;
  const [vx1, vy1, vx2, vy2] = rect;
  const x1 = Math.max(0, (Math.min(vx1, vx2) - transform.left) / transform.scaleX);
  const y1 = Math.max(0, (Math.min(vy1, vy2) - transform.top) / transform.scaleY);
  const x2 = Math.min(size.width, (Math.max(vx1, vx2) - transform.left) / transform.scaleX);
  const y2 = Math.min(size.height, (Math.max(vy1, vy2) - transform.top) / transform.scaleY);
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

/** A viewport rectangle in CSS px as a box in the captured screenshot (ratio = measured bitmap width / viewport width). */
export function viewportRectToBitmapBox(rect, ratio, size) {
  if (!Array.isArray(rect) || rect.length !== 4 || !(ratio > 0)) return null;
  const x1 = Math.max(0, Math.min(rect[0], rect[2]) * ratio);
  const y1 = Math.max(0, Math.min(rect[1], rect[3]) * ratio);
  const x2 = Math.min(size.width, Math.max(rect[0], rect[2]) * ratio);
  const y2 = Math.min(size.height, Math.max(rect[1], rect[3]) * ratio);
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

export function iou(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (!(w > 0 && h > 0)) return 0;
  const inter = w * h;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * The entry for a drawn box. `read` is identifyCard's answer (with the usual fusion and confirm rules, so a drawn card
 * is never confirmed because it was drawn); a box under the read gate has no read and becomes a Too small entry.
 * `box` is in the viewport, like every other card's box.
 */
export function drawnCardEntry({ box, read = null, tooSmall = false, readHeight, crop = null, ...extra }) {
  const marks = { via: DRAWN_VIA, drawn: true, share: null, ...extra };
  const entry = tooSmall || !read
    ? tooSmallCard({ box, score: null, readHeight, ...marks })
    : { score: null, ...read, box, readHeight, ...marks };
  return crop ? { ...entry, crop } : entry;
}

/**
 * Hidden (not a card) entries and Too small entries: the ones a drawn box may stand in for. One read from another
 * photo of a listing's gallery is not on the page, so it is never the place the user drew.
 */
const isReplaceable = (card) => (card?.notCard === true || card?.tooSmall === true) && card.inGallery !== true;

// Document boxes when both entries have them (a whole-page scan, and every drawn box), else the viewport boxes.
function sameSpace(card, entry) {
  return Array.isArray(card.docBox) && Array.isArray(entry.docBox) ? [card.docBox, entry.docBox] : [card.box, entry.box];
}

/**
 * The card list with the drawn entry in it: it takes the place of the best-overlapping hidden or Too small entry for the
 * same place (IoU >= REPLACE_IOU), else it is appended with the next row number. The list given is not changed.
 */
export function placeDrawnCard(cards, entry) {
  const list = Array.isArray(cards) ? cards : [];
  let at = -1;
  let best = REPLACE_IOU;
  list.forEach((card, i) => {
    if (!isReplaceable(card) || !Array.isArray(card.box)) return;
    const [a, b] = sameSpace(card, entry);
    const overlap = iou(a, b);
    if (overlap >= best) { best = overlap; at = i; }
  });
  if (at < 0) return { cards: [...list, entry], index: list.length, replaced: false };
  return { cards: list.map((card, i) => (i === at ? entry : card)), index: at, replaced: true };
}

/**
 * What the page sent for a drawn box, checked: the photo it lies over, the rectangle in viewport CSS px, and the
 * viewport it was drawn in. Null when anything is malformed or the rectangle is under the minimum side.
 */
export function normalizeDrawnMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const { photo, drawn } = msg;
  if (!photo || typeof photo !== "object" || !photo.rect || typeof photo.rect !== "object") return null;
  if (!Array.isArray(drawn) || drawn.length !== 4 || !drawn.every(finite)) return null;
  const rect = [Math.min(drawn[0], drawn[2]), Math.min(drawn[1], drawn[3]), Math.max(drawn[0], drawn[2]), Math.max(drawn[1], drawn[3])];
  if (rect[2] - rect[0] < MIN_DRAW_SIDE || rect[3] - rect[1] < MIN_DRAW_SIDE) return null;
  const r = photo.rect;
  if (![r.x, r.y, r.w, r.h].every(finite) || !(r.w > 0 && r.h > 0)) return null;
  return {
    photo,
    drawn: rect,
    viewportWidth: finite(msg.viewportWidth) && msg.viewportWidth > 0 ? msg.viewportWidth : 0,
    viewportHeight: finite(msg.viewportHeight) && msg.viewportHeight > 0 ? msg.viewportHeight : 0,
    devicePixelRatio: finite(msg.devicePixelRatio) && msg.devicePixelRatio > 0 ? msg.devicePixelRatio : 1,
    scroll: { x: finite(msg.scrollX) ? msg.scrollX : 0, y: finite(msg.scrollY) ? msg.scrollY : 0 },
    page: msg.page && typeof msg.page === "object" ? msg.page : {},
  };
}

const CROP_PREFIX = "data:image/jpeg;base64,";

/**
 * The picture and share a correction, skip or teach pick is about. A drawn row may sit at the index of a box it replaced,
 * so scan.crops[index] and scan.shares[index] describe another picture: a drawn row uses only the crop it brought
 * (null when that is missing or not a JPEG data URL) and never has a share.
 */
export function correctionSource(scan, msg) {
  if (msg?.drawn === true) return { crop: typeof msg.crop === "string" && msg.crop.startsWith(CROP_PREFIX) ? msg.crop : null, share: null };
  return { crop: scan?.crops?.[msg?.index], share: scan?.shares?.[msg?.index] };
}

/** Row numbers of the drawn cards. */
export function drawnIndices(cards) {
  const found = [];
  (Array.isArray(cards) ? cards : []).forEach((card, index) => { if (card?.drawn === true) found.push(index); });
  return found;
}

const withoutHash = (url) => String(url).split("#")[0];

/** Whether a drawn card belongs to the page the current result is for. Unknown on either side is not the same page. */
export function isSamePage(resultUrl, drawnUrl) {
  if (typeof resultUrl !== "string" || typeof drawnUrl !== "string" || !resultUrl || !drawnUrl) return false;
  return withoutHash(resultUrl) === withoutHash(drawnUrl);
}

/**
 * Whether a drawn card belongs to the lot the list holds: the same page and, when both tab ids are known, the same tab
 * (two tabs on one URL are two lots). An unknown tab id on either side falls back to the page alone, so lots saved
 * before tab ids were kept still work.
 */
export function isSameLot(lot, drawn) {
  if (!isSamePage(lot?.url, drawn?.url)) return false;
  return Number.isInteger(lot.tabId) && Number.isInteger(drawn.tabId) ? lot.tabId === drawn.tabId : true;
}

/**
 * The tab id a restored lot belongs to: the tab the restore was done for (the scanState reply's tab id), never one saved
 * with the lot, because a lot is found by URL and may be reopened in another tab. Null when unknown.
 */
export function restoredLotTabId(state) {
  return Number.isInteger(state?.tabId) ? state.tabId : null;
}

/** A drawn box is taken only from the tab that started draw mode, and from its top frame. */
export function acceptDrawnSender(drawTabId, sender) {
  return Number.isInteger(drawTabId) && sender?.tab?.id === drawTabId && sender.frameId === 0;
}

/** A drawn row's pick is never queued for the shared exam. */
export const examHoldAllowed = (msg) => msg?.drawn !== true;

/** An exam photo is sent whole: one holding a drawn row (not the box the scan shared) is not sent at all. */
export const examGroupAllowed = (indices, drawn) => !(indices || []).some((index) => (drawn || []).includes(index));
