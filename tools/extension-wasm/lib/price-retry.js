// A card the scan itself confirmed, whose price failed in the scan's own batch pricing, is asked for its price once more
// by itself, a few seconds later (popup.js decides when). It fetches the price only: it never confirms anything for the user.
// Pure rules only: no timers, no chrome globals. A lookup that succeeded with "no price" never reaches here: it has no priceError.

import { chooseState } from "./choose-flow.js";

export const AUTO_PRICE_RETRY_MS = 5000;

/**
 * True only for a card the scan confirmed (state "confirmed"), that holds an identity id and sits on a failed price
 * lookup, with nothing pricing it right now and not removed. Never for a row in Choose (an unsure guess, or a user's pick whose lookup
 * failed), a skipped row or a card back: the user has not confirmed those, so they get no price until the user acts.
 */
export function wantsAutoRetry(card) {
  return Boolean(card?.priceError && card.identity?.id && card.pricing !== true && card.removed !== true && chooseState(card) === "confirmed");
}

/**
 * Whether a retry's answer may be written to its row when it arrives: the row must still hold the card id the retry was
 * started for (a version swap or any other change of card since then drops the answer), must not be removed or skipped,
 * and must not be a row the user has started a lookup on.
 */
export function retryAnswerLands(card, startedId, userLookupRow) {
  return Boolean(card && startedId && card.identity?.id === startedId && card.removed !== true && card.skipped !== true && !userLookupRow);
}

/** One key per scan, row and card, so a row that changed card or scan is a different failure with its own retry. */
export const retryKey = (scanId, idx, cardId) => `${scanId}:${idx}:${cardId}`;
