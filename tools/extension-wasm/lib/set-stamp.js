// EX set-logo stamps. From Unseen Forces (ex10) to Power Keepers (ex16) the reverse holos, and only they, print the
// expansion logo in the bottom-right corner of the art. A logo read there settles the set and the Reverse Holofoil
// price without a pick (owner decision 2026-10-25), when the card's name is in that set and that price exists.

import { choiceForStamp, stampSetCode, variantChoice } from "./variant.js";

export const NO_REVERSE_PRICE = "Reverse holo price not available";

const reverseKey = (grid) => variantChoice({ edition: null, finish: "reverse", stamp: null }, grid?.variants).key;

// The card is the one its logo named: the user may still pick another set, and then the stamp read was wrong.
const isStampedCard = (card) => Boolean(card?.stampSet) && card.identity?.setCode === card.stampSet;

/**
 * The price fields ({ price_grid, market_price, price_variant }) a stamped card may carry. It is a reverse holo, so
 * with no Reverse Holofoil price it has no price at all, never another printing's (director decision 2026-10-25).
 * Any other card's fields are returned as they are.
 */
export function stampedPrices(card, prices) {
  if (!isStampedCard(card) || reverseKey(prices?.price_grid)) return prices;
  const grid = prices?.price_grid;
  return { ...prices, price_grid: grid ? { ...grid, variants: {} } : null, market_price: null, price_variant: null };
}

// In the delta-species sets the catalog names a δ card "Pinsir δ"; the picture reads "Pinsir" (director decision
// 2026-10-25). Every other set compares names exactly.
const DELTA_SETS = new Set(["ex11", "ex13", "ex15"]);
const DELTA_SUFFIX = /\s+(?:δ|delta)$/i;
const plainName = (name) => String(name || "").trim().toLowerCase();

/** The read name is this catalog card's name, in the stamp's set. */
export function sameStampName(catalogName, readName, setCode) {
  const read = plainName(readName);
  if (!read) return false;
  const named = plainName(catalogName);
  return named === read || (DELTA_SETS.has(setCode) && named.replace(DELTA_SUFFIX, "") === read.replace(DELTA_SUFFIX, ""));
}

// The one catalog card of the stamp's set: the offered printing in that set, else the card of that name there
// (by number when the set prints the name more than once). Null when the set does not have the card.
function stampedCard(result, code, text, { cardsInSet, catalogCard }) {
  const offered = choiceForStamp(result.setChoices, text);
  if (offered) return catalogCard(offered.id) || null;
  const name = result.identity?.name;
  if (!name) return null;
  const named = (cardsInSet(code) || []).filter((card) => sameStampName(card.name, name, code));
  if (named.length === 1) return named[0];
  const numbered = named.filter((card) => String(card.number) === String(result.identity.number ?? ""));
  return numbered.length === 1 ? numbered[0] : null;
}

/**
 * Applies an art-corner set logo to a scan read (mutated and returned). The read is left as it was when the stamp
 * was cleared, the text names no single stamp set, the set does not have the card, or the printed number already
 * placed the card in another set or read another finish.
 * @param deps {{ cardsInSet(setCode): object[], catalogCard(id): object|undefined, priceIdentity(card): Promise<object> }}
 */
export async function applySetStamp(result, text, { cardsInSet, catalogCard, priceIdentity }) {
  if (result?.variant?.stamp !== "setstamp") return result;
  const code = stampSetCode(text);
  if (!code) return result;
  const current = result.identity;
  if (result.setEvidence === "number" && current?.setCode && current.setCode !== code) return result;
  if (result.finishSure && result.finishSure !== "reverse") return result;
  const card = stampedCard(result, code, text, { cardsInSet, catalogCard });
  if (!card) return result;
  if (current?.id !== card.id) Object.assign(result, await priceIdentity(card));
  result.identity = card;
  result.stampSet = code;
  result.setChoices = undefined;
  delete result.setRange;
  result.setEvidence = "stamp";
  Object.assign(result, stampedPrices(result, {
    price_grid: result.price_grid ?? null, market_price: result.market_price ?? null, price_variant: result.price_variant ?? null,
  }));
  result.setUnconfirmed = false;
  result.abstain = false;
  // The logo is printed on reverse holos only, so a photo model's other finish never stands as a suggestion.
  result.variant = { ...result.variant, finish: "reverse" };
  if (reverseKey(result.price_grid)) result.finishSure = "reverse";
  return result;
}

/** The note a stamped card shows when its set has no Reverse Holofoil price (it then shows no price at all). */
export function stampFinishNote(card) {
  if (!isStampedCard(card)) return null;
  return reverseKey(card.price_grid) ? null : NO_REVERSE_PRICE;
}
