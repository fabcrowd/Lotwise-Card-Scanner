// The X on a card of the page overlay: takes that card out of the scan and the lot total.
// The page sends {action:'overlayRemove', index} to the background, which is the one place that decides:
//   - the scanner window is open on that tab: it is asked to apply the removal ('applyOverlayRemove');
//   - otherwise (window closed, or it could not take it) the saved lot and the held scan are changed here.
// The page drops the box only when the background says the removal is stored ({ok: true}).

import { isSamePage } from "./draw-box.js";
import { isNotCard } from "./not-card.js";
import { removeCard } from "./skip.js";

/** A card the X can remove: in the lot, a real row (not a hidden not-card box) and not already removed. */
const removable = (card) => Boolean(card) && !isNotCard(card) && card.removed !== true;

/** The page's click, as the background receives it: from this extension's content script, in a tab's top frame. */
export function acceptPageSender(sender, extensionId) {
  return Boolean(sender) && sender.id === extensionId && Boolean(sender.tab) && sender.frameId === 0;
}

/** The background's forward to the scanner window: from this extension's own context, never from a tab. */
export function acceptFromBackground(sender, extensionId) {
  return Boolean(sender) && sender.id === extensionId && !sender.tab;
}

/** Whether the removal of card `index` is taken for the lot of `lotUrl`: the same page, and a card that can be removed. */
export function acceptRemove(tabUrl, index, lotUrl, cards) {
  if (!isSamePage(lotUrl, tabUrl)) return false;
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(cards)) return false;
  return removable(cards[index]);
}

/** A saved lot state with the card at `index` removed, or null when there is no such removable card. */
export function removeFromLot(state, index) {
  const cards = state?.cards;
  if (!Array.isArray(cards) || !Number.isInteger(index) || index < 0) return null;
  if (!removable(cards[index])) return null;
  return { ...state, cards: cards.map((c, i) => (i === index ? removeCard(c) : c)) };
}

/**
 * Whether the page may drop the box: the scanner window applied it, or the saved lot or held scan really changed.
 * A window that was asked and declined stores nothing. A scan still running for the page would replace the list, so nothing stored then counts.
 */
export function removalStored({ popupHandled = false, popupDeclined = false, savedChanged = false, heldChanged = false, running = false } = {}) {
  if (popupHandled) return true;
  // The open window holds the list and would overwrite a change made behind its back on its next save.
  if (popupDeclined) return false;
  if (running) return false;
  return savedChanged || heldChanged;
}
