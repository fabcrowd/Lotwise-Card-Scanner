// Prices for Japanese cards: TCGPlayer's own market prices as tcgcsv.com publishes them, one request per set (group).

import { computeSpread, pickDefaultPrinting } from "./condition-pricing.js";

const POKEMON_JAPAN_CATEGORY = 85;
const TCGCSV_BASE = "https://tcgcsv.com/tcgplayer/";
const TIMEOUT_MS = 10_000;
export const JA_PRICE_TTL_MS = 6 * 60 * 60 * 1000;

const KNOWN_PRINTINGS = { Normal: "normal", Holofoil: "holofoil", "Reverse Holofoil": "reverseHolofoil" };

function variantKey(subTypeName) {
  const known = KNOWN_PRINTINGS[subTypeName];
  if (known) return known;
  const words = String(subTypeName ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return "normal";
  return words.map((word, i) => (i === 0 ? word[0].toLowerCase() : word[0].toUpperCase()) + word.slice(1)).join("");
}

const positiveNumber = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The usable prices of a group's rows: [{ productId, subTypeName, marketPrice }]. A row needs an integer product id and a
 * market price above 0. The middle-of-listings price is not used: the price grid has no place to say a figure is not the market price.
 */
export function parsePriceRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const marketPrice = positiveNumber(row?.marketPrice);
    if (!Number.isInteger(row?.productId) || marketPrice == null) return [];
    return [{ productId: row.productId, subTypeName: typeof row.subTypeName === "string" ? row.subTypeName : "", marketPrice }];
  });
}

/** The price grid of one product from a group's price rows, or null when it has no usable price. */
export function fromTcgcsvPrices(rows, productId, fetchedAt) {
  const variants = {};
  for (const row of parsePriceRows(rows)) {
    if (row.productId !== productId) continue;
    const key = variantKey(row.subTypeName);
    if (variants[key]) continue;
    variants[key] = { conditions: { NM: row.marketPrice, LP: null, MP: null, HP: null, DMG: null }, market: row.marketPrice };
  }
  if (Object.keys(variants).length === 0) return null;
  return {
    source: "tcgcsv",
    variants,
    graded: {},
    defaultVariant: pickDefaultPrinting(variants),
    spreadRatio: computeSpread(variants),
    updatedAt: new Date(fetchedAt).toISOString(),
  };
}

/**
 * The price fields a scan row carries for a Japanese card, and whether the lookup failed (no answer from the price list).
 * A failure is not the same as "no price for this card": the caller must not keep a failed answer.
 */
export async function jaLookup(identity, client, fetchedAt) {
  const rows = await client.groupPrices(identity.groupId);
  const grid = fromTcgcsvPrices(rows, identity.tcgPlayerId, fetchedAt);
  const variant = grid?.defaultVariant ?? null;
  return {
    result: { market_price: variant ? grid.variants[variant].market : null, price_variant: variant, price_grid: grid },
    failed: rows == null,
  };
}

/** Parsed price rows per group, cached for six hours, one request shared by concurrent callers. Null on any failure, which is not cached. */
export function createJaPriceClient({ fetchFn = (...args) => fetch(...args), now = Date.now } = {}) {
  const cache = new Map();
  const inflight = new Map();
  async function load(groupId) {
    try {
      const response = await fetchFn(`${TCGCSV_BASE}${POKEMON_JAPAN_CATEGORY}/${groupId}/prices`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response?.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body?.results)) return null;
      const rows = parsePriceRows(body.results);
      const at = now();
      for (const [key, hit] of cache) if (at - hit.at >= JA_PRICE_TTL_MS) cache.delete(key);
      cache.set(groupId, { rows, at });
      return rows;
    } catch {
      return null;
    }
  }
  return {
    async groupPrices(groupId) {
      const hit = cache.get(groupId);
      if (hit && now() - hit.at < JA_PRICE_TTL_MS) return hit.rows;
      if (!inflight.has(groupId)) inflight.set(groupId, load(groupId).finally(() => inflight.delete(groupId)));
      return inflight.get(groupId);
    },
    // For tests: how many groups are held.
    size: () => cache.size,
  };
}
