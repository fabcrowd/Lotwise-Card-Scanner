// Batch pricing helpers for the scan path, kept free of chrome globals so they can be tested with fakes.
// Price never decides confirmation: nothing here touches setConfirmed / abstain.

import { stampedPrices } from "./set-stamp.js";

export const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;
export const PRICE_CACHE_PREFIX = "priceCache_";
export const PRICE_ERROR_TEXT = "Couldn't get a price. Try again.";
export const CORNER_RETRY_MS = 60 * 1000;

const NO_PRICE = () => ({ market_price: null, price_variant: null, price_grid: null });

/** A result is worth keeping an hour only when it carries a price or a non-empty grid. */
export function hasPrice(price) {
  if (!price) return false;
  if (price.market_price != null) return true;
  return Object.keys(price.price_grid?.variants || {}).length > 0;
}

/** Removes every priceCache_ entry, so prices fetched under an old PokemonPriceTracker setting are not served. */
export async function clearPriceCache(storage) {
  const all = await storage.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(PRICE_CACHE_PREFIX));
  if (keys.length) await storage.remove(keys);
}

/** Persistent price cache over a chrome.storage.local-shaped object (promise API). */
export function createPriceCache(storage, { now = Date.now } = {}) {
  const key = (id) => PRICE_CACHE_PREFIX + id;
  const expired = (entry) => !entry || now() - entry.ts > PRICE_CACHE_TTL_MS;
  let pruned = false;

  return {
    async get(id) {
      const result = await storage.get(key(id));
      const entry = result[key(id)];
      if (!entry) return null;
      if (expired(entry)) {
        await storage.remove(key(id));
        return null;
      }
      return entry.value;
    },
    async set(id, value) {
      await storage.set({ [key(id)]: { value, ts: now() } });
    },
    /** Removes every expired priceCache_ entry. Runs at most once per cache object (one service-worker start). */
    async pruneOnce() {
      if (pruned) return;
      pruned = true;
      const all = await storage.get(null);
      const stale = Object.keys(all).filter((k) => k.startsWith(PRICE_CACHE_PREFIX) && expired(all[k]));
      if (stale.length) await storage.remove(stale);
    },
  };
}

/** Fetches prices for unique card ids: persistent cache first, then parallel fetches. Returns Map(id -> price). */
export async function batchPriceCards(cardIds, { cache, catalogCard, priceIdentity, log = () => {}, concurrency = 6 }) {
  const uniqueIds = [...new Set(cardIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  await cache.pruneOnce().catch((err) => log("[BG] price cache prune failed", err?.message || err));

  const result = new Map();
  const toFetch = [];
  for (const id of uniqueIds) {
    const cachedPrice = await cache.get(id);
    if (cachedPrice) result.set(id, cachedPrice);
    else toFetch.push(id);
  }

  for (let i = 0; i < toFetch.length; i += concurrency) {
    const batch = toFetch.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (id) => {
      const identity = catalogCard(id);
      if (!identity) return [id, NO_PRICE()];
      try {
        const price = await priceIdentity(identity);
        if (hasPrice(price)) await cache.set(id, price);
        return [id, price];
      } catch (err) {
        log("[BG] batch price failed for", id, err?.message || err);
        return [id, { ...NO_PRICE(), priceError: PRICE_ERROR_TEXT }];
      }
    }));
    for (const [id, price] of results) result.set(id, price);
  }
  return result;
}

/** Every card id that needs a price: the identity, its version choices (and their own set choices) and its set choices. */
export function collectBatchIds(cards) {
  const ids = new Set();
  const add = (id) => { if (id) ids.add(id); };
  for (const card of cards) {
    add(card.identity?.id);
    for (const vc of card.versionChoices || []) {
      add(vc.id);
      for (const sc of vc.setChoices || []) add(sc.id);
    }
    for (const sc of card.setChoices || []) add(sc.id);
  }
  return ids;
}

/** Prices a row's set choices in place and returns their range summary (every choice counts, priced or not). */
function priceSetChoices(row, priceMap, setRangeSummary) {
  for (const sc of row.setChoices) {
    if (sc.id && priceMap.has(sc.id)) assignPrice(sc, priceMap.get(sc.id));
  }
  return setRangeSummary(row.setChoices.map((sc) => ({
    market_price: sc.market_price, price_variant: sc.price_variant, price_grid: sc.price_grid,
  })));
}

function assignPrice(target, price) {
  target.market_price = price.market_price;
  target.price_variant = price.price_variant;
  target.price_grid = price.price_grid;
  if (price.priceError) target.priceError = price.priceError;
}

/** Applies batched prices to cards (mutated). A set-stamped card's own price goes through stampedPrices. */
export function applyBatchedPrices(cards, priceMap, { setRangeSummary }) {
  for (const card of cards) {
    if (card.identity?.id && priceMap.has(card.identity.id)) {
      const price = priceMap.get(card.identity.id);
      assignPrice(card, card.stampSet ? { ...price, ...stampedPrices(card, price) } : price);
    }
    for (const vc of card.versionChoices || []) {
      if (vc.id && priceMap.has(vc.id)) assignPrice(vc, priceMap.get(vc.id));
      if (vc.setChoices) {
        const setRange = priceSetChoices(vc, priceMap, setRangeSummary);
        if (setRange) vc.setRange = setRange;
      }
    }
    if (card.setChoices) {
      const setRange = priceSetChoices(card, priceMap, setRangeSummary);
      if (setRange) card.setRange = setRange;
    }
  }
}

/** Memoizes an async loader, but a failed load is forgotten so a later call retries (at most once per minRetryMs). */
export function createRetryLoader(load, { now = Date.now, minRetryMs = CORNER_RETRY_MS, log = () => {} } = {}) {
  let pending = null;
  let failedAt = null;
  return function run() {
    if (pending) return pending;
    if (failedAt != null && now() - failedAt < minRetryMs) return Promise.resolve();
    pending = (async () => {
      try {
        await load();
      } catch (err) {
        log(err);
        failedAt = now();
        pending = null;
      }
    })();
    return pending;
  };
}
