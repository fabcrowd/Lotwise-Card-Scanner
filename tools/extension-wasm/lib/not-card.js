// A box the "is this a card" check rejected is hidden, not dropped: the scan keeps its read (when it had one) so the
// user can bring it back with "Show it". A hidden entry is shaped like a card back, so totals, export, the choose flow,
// batch pricing, sharing and the corrections memory never see it, and it is never drawn on the page.

import { escHtml } from "./card-picker.js";
import { keepTooSmall } from "./tiny-card.js";

export const NOT_CARD_HEADING = "Not a card";

// What describes where the card is and how it was found: kept from the hidden entry when it is shown.
const PLACE_KEYS = ["box", "docBox", "score", "via", "photoBoxes", "readHeight", "photo", "inGallery", "crop", "tooSmall"];

export const isNotCard = (card) => card?.notCard === true;

export const UNREAD_ROW_TEXT = "Not read. Draw a box around it to read it.";
// Full reads of rejected boxes per scan. It bounds the cost on pages full of look-alikes (a coin tray); a box past it
// is kept unread, and "Show it" on one says so.
export const HIDDEN_READ_CAP = 12;

export const canReadHidden = (readSoFar) => readSoFar < HIDDEN_READ_CAP;

export const realCards = (cards) => (cards || []).filter((card) => !isNotCard(card));

/** Real cards kept so far (hidden and replaced entries not counted): what the card cap and the fallbacks look at. */
export const keptRealCount = (cards, dropped = new Set()) => (cards || []).filter((card, i) => !isNotCard(card) && !dropped.has(i)).length;

/** Whether a rejected box is kept as a hidden entry, given its claim slot. A too-small one follows the keepTooSmall rule. */
export function keepHidden({ tooSmall, claimed, mappedBox, gallery }) {
  if (tooSmall) return keepTooSmall({ claimed, mappedBox, gallery });
  return Boolean(claimed) && claimed.replaces == null;
}

/** The popup message after "Show it". */
export function shownMessage(shown, toConfirm) {
  if (shown.tooSmall) return "Shown as too small to read.";
  if (shown.unread) return "Shown as not read.";
  if (shown.cardBack) return "It reads as a card back.";
  return `Shown. ${toConfirm} to confirm.`;
}

export const hiddenCount = (cards) => (cards || []).filter(isNotCard).length;

/** `read` is identifyCard's answer for a box big enough to read, or null for a too-small one. */
export function notCardEntry({ box, score, read = null, readHeight, tooSmall = false, unread = false, ...extra }) {
  return {
    box, score, ...extra,
    notCard: true, hiddenRead: read,
    identity: null, confidence: 0, abstain: true, cardBack: true,
    market_price: null, price_variant: null, price_grid: null, readHeight,
    ...(tooSmall ? { tooSmall: true } : {}),
    ...(unread && !tooSmall && !read ? { unread: true } : {}),
  };
}

/**
 * The entry as a normal row. A read becomes a Choose row (never confirmed on its own: the user still picks);
 * a too-small box becomes the Too small row.
 */
export function showNotCard(card) {
  const { hiddenRead, ...rest } = card;
  delete rest.notCard;
  if (!hiddenRead) return { ...rest, cardBack: true };
  const place = Object.fromEntries(PLACE_KEYS.filter((key) => key in rest).map((key) => [key, rest[key]]));
  const shown = { ...rest, ...hiddenRead, ...place, unsure: true };
  delete shown.cardBack;
  if (hiddenRead.cardBack) shown.cardBack = true;
  delete shown.setConfirmed;
  delete shown.userConfirmed;
  delete shown.skipped;
  delete shown.tooSmall;
  return shown;
}

/** The cards as the page overlay gets them: a hidden entry keeps its place in the list (row numbers) but has no box. */
export function overlayCards(cards) {
  return (cards || []).map((card) => (isNotCard(card) ? { box: null, notCard: true } : card));
}

export const notCardHeading = (count) => `${NOT_CARD_HEADING} (${count})`;

/** The collapsed group at the bottom of the list; rows are already-escaped HTML. */
export function renderNotCardGroup(rowsHtml, count, expanded) {
  if (!count) return "";
  return `<div class="skipped-group">
    <button type="button" class="unrec-toggle skipped-toggle" id="notcard-heading" data-notcard-toggle aria-expanded="${expanded}" aria-controls="notcard-list">${escHtml(notCardHeading(count))}</button>
    <div id="notcard-list" class="unrec-list"${expanded ? "" : " hidden"}>${rowsHtml}</div>
  </div>`;
}

/** One hidden entry: its crop and "Show it". Never a name or a price. */
export function renderNotCardRow(idx, crop, tooSmall, unread = false) {
  const what = tooSmall ? "too small to read" : "not a card";
  const draw = unread && !tooSmall ? `<button type="button" class="link-btn" data-draw-box aria-label="${escHtml(`Draw a box around box ${idx + 1} to read it`)}">Draw a box</button>` : "";
  return `<div class="card-row unrec-row skipped-row" data-idx="${idx}">
    <div class="unrec-line">
      ${crop ? `<button type="button" class="unrec-thumb" data-show-on-page data-idx="${idx}" title="Show this box on the page" aria-label="Show box ${idx + 1} on the page"><img src="${escHtml(crop)}" alt="" width="34" height="48"></button>` : ""}
      <span class="unrec-name">Box ${idx + 1}: ${what}</span>
      <button type="button" class="link-btn" data-show-hidden data-idx="${idx}" aria-label="${escHtml(`Show box ${idx + 1} as a card`)}">Show it</button>
      ${draw}
    </div>
  </div>`;
}
