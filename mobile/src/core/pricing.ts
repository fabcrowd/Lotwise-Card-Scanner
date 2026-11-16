// The price of a confirmed card. Same sources and the same order as the extension's priceIdentity (background.js):
// the user's price-service key when they saved one, then TCGdex joined with the shared daily price file published on
// GitHub, then pokemontcg.io. A card is priced only after the user confirmed it.

import {
  applyCatalogPrices, applySnapshot, currentSnapshot, extractTcgPlayerId, fromPokemontcgPayload, fromTcgdexPayload,
  getConditionGrid, getFullCardPayload, getPptKey, getTcgdexCard, tcgPlayerIdFromTcgdex,
} from './ext';
import type { CatalogCard, PriceFields, ScanRow } from './types';

const LEGACY_VARIANT_ORDER = ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil', '1stEditionNormal'];

type VariantPrices = Record<string, { market?: number; mid?: number }>;

function legacyPrice(prices: VariantPrices | undefined): { price: number; variant: string } | null {
  if (!prices) return null;
  for (const variant of [...LEGACY_VARIANT_ORDER, ...Object.keys(prices)]) {
    const price = prices[variant]?.market ?? prices[variant]?.mid;
    if (price != null) return { price, variant };
  }
  return null;
}

export async function priceIdentity(identity: CatalogCard): Promise<PriceFields> {
  const [tcgdex, full, snapshot] = await Promise.all([
    getTcgdexCard(identity.id),
    getFullCardPayload(identity.id),
    currentSnapshot(),
  ]);
  const tcgdexGrid = fromTcgdexPayload(tcgdex, identity);
  const prices = full?.tcgplayer?.prices;
  const tcgPlayerId = tcgPlayerIdFromTcgdex(tcgdex) ?? extractTcgPlayerId(full?.tcgplayer?.url);
  // getConditionGrid also asks the developer's price server on this machine's port 3000. A phone has none, and
  // must not take prices from whatever else listens there, so it is called only for the user's own price-service key.
  const keyed = (await getPptKey()) ? await getConditionGrid({ ...identity, tcgPlayerId }) : null;
  const grid = keyed
    ?? applyCatalogPrices(tcgdexGrid ? applySnapshot(tcgdexGrid, snapshot) : null, snapshot, identity)
    ?? fromPokemontcgPayload(prices, full?.tcgplayer?.updatedAt);
  const legacy = legacyPrice(prices);
  return { market_price: legacy?.price ?? null, price_variant: legacy?.variant ?? null, price_grid: grid ?? null };
}

/**
 * The row to keep when a price answer arrives. The answer is used only if the row is still the same confirmed card
 * and still waiting for it: the user may have changed the card, or taken the confirmation back, in the meantime.
 */
export function acceptPrice(current: ScanRow, priced: ScanRow): ScanRow {
  const waiting = current.userConfirmed === true && current.pricing === true;
  const same = Boolean(current.identity?.id) && current.identity?.id === priced.identity?.id;
  return waiting && same ? priced : current;
}

/** The confirmed row with its price filled in, or flagged when no price could be fetched. */
export async function priceRow(row: ScanRow): Promise<ScanRow> {
  const identity = row.identity;
  if (!identity?.id || !identity.name) return { ...row, pricing: false, priceError: true };
  try {
    const price = await priceIdentity(identity as CatalogCard);
    const found = price.market_price != null || Object.keys(price.price_grid?.variants ?? {}).length > 0;
    return { ...row, ...price, pricing: false, priceError: !found };
  } catch (err) {
    console.error('[pricing] no price for', identity.id, err instanceof Error ? err.message : err);
    return { ...row, pricing: false, priceError: true };
  }
}
