// One prices.json on the data repo, published nightly. Every install downloads that file.
// A price replaces the TCGdex number only when this card's TCGPlayer product id is in the file; an ex10-ex16 printing
// TCGdex does not price at all is added from the file's prices by catalog id.

import { PRICE_SNAPSHOT_URL } from "./shared-config.js";

export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_SNAPSHOT_CHARS = 8_000_000;
const STORAGE_KEY = "priceSnapshot1";
const FAIL_MS = 15 * 60 * 1000;
// The release answers 404 until the nightly has published its first prices.json: expected, not a fault.
const NOT_PUBLISHED = 404;

const SUBTYPE = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  unlimitedHolofoil: "Unlimited Holofoil",
  unlimited: "Unlimited",
  "1stEditionHolofoil": "1st Edition Holofoil",
  "1stEditionNormal": "1st Edition",
};

function roundPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

function spreadOf(variants) {
  const markets = Object.values(variants).map((variant) => variant.market).filter((price) => price > 0);
  if (markets.length < 2) return 1;
  return Math.max(...markets) / Math.min(...markets);
}

// `byCatalog`: prices by catalog id for the ex10-ex16 cards (their reverse holos carry the set logo), joined by
// number and name, so a card TCGdex has no product id or reverse price for is still priced. `stamped`: stamped
// products, kept for the Stamp choice. A section that is not the expected shape, or over its bound, is dropped whole;
// a bad entry inside it is dropped alone. Neither ever rejects the file.
export const MAX_CATALOG_CARDS = 5000;
export const MAX_STAMPED_ROWS = 20000;
const CATALOG_SETS = new Set(["ex10", "ex11", "ex12", "ex13", "ex14", "ex15", "ex16"]);
const CATALOG_ID = /^[a-z0-9][a-z0-9.]{0,15}-[A-Za-z0-9]{1,12}$/;
const PRINTING_OF = Object.fromEntries(Object.entries(SUBTYPE).map(([printing, subtype]) => [subtype, printing]));
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const priceOrNull = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const shortText = (value, max) => (typeof value === "string" && value.length > 0 && value.length <= max ? value : null);

function parseByCatalog(raw) {
  if (!isPlainObject(raw)) return {};
  const entries = Object.entries(raw);
  if (entries.length > MAX_CATALOG_CARDS) return {};
  const out = {};
  for (const [id, row] of entries) {
    if (!CATALOG_ID.test(id) || !isPlainObject(row)) continue;
    const prices = {};
    for (const [subtype, price] of Object.entries(row)) {
      if (PRINTING_OF[subtype] && priceOrNull(price) != null) prices[subtype] = price;
    }
    if (Object.keys(prices).length) out[id] = prices;
  }
  return out;
}

function parseStamped(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_STAMPED_ROWS) return [];
  const out = [];
  for (const row of raw) {
    if (!isPlainObject(row)) continue;
    const catalogId = typeof row.catalogId === "string" && CATALOG_ID.test(row.catalogId) ? row.catalogId : null;
    const stamp = typeof row.stamp === "string" && /^[a-z]{1,24}$/.test(row.stamp) ? row.stamp : null;
    // A Prize Pack product (its whole group is stamped) has no tag.
    const tag = row.tag === null ? null : shortText(row.tag, 120);
    const subtype = shortText(row.subtype, 40);
    const productId = Number.isSafeInteger(row.productId) && row.productId > 0 ? row.productId : null;
    if (!catalogId || !stamp || (tag === null && row.tag !== null) || !subtype || !productId) continue;
    out.push({ catalogId, stamp, tag, productId, subtype, market: priceOrNull(row.market), mid: priceOrNull(row.mid), low: priceOrNull(row.low) });
  }
  return out;
}

/** The parsed snapshot, or an error when the file is not the shape this build stores. */
export function parseSnapshot(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_SNAPSHOT_CHARS) {
    throw new Error("price snapshot is too large");
  }
  const data = JSON.parse(text);
  if (data?.v !== 1 || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw new Error("price snapshot has no date");
  }
  if (!data.prices || typeof data.prices !== "object" || Array.isArray(data.prices)) {
    throw new Error("price snapshot has no prices");
  }
  return { v: 1, updatedAt: data.updatedAt, prices: data.prices, byCatalog: parseByCatalog(data.byCatalog), stamped: parseStamped(data.stamped) };
}

/**
 * Add the printings an ex10-ex16 card's TCGdex grid lacks (all of them when there is no grid) from the snapshot's
 * `byCatalog`, dated like any snapshot price. A printing TCGdex prices stays; a richer grid (backend, Price Tracker),
 * another card, an undated snapshot or nothing to add returns the grid it was given.
 */
export function applyCatalogPrices(grid, snapshot, identity) {
  if (grid && grid.source !== "tcgdex") return grid;
  if (!CATALOG_SETS.has(identity?.setCode)) return grid;
  const row = isPlainObject(snapshot?.byCatalog) ? snapshot.byCatalog[identity.id] : null;
  const updatedAt = typeof snapshot?.updatedAt === "string" && Number.isFinite(Date.parse(snapshot.updatedAt)) ? snapshot.updatedAt : null;
  if (!isPlainObject(row) || !updatedAt) return grid;
  const variants = { ...(grid?.variants || {}) };
  let added = 0;
  for (const [subtype, price] of Object.entries(row)) {
    const printing = PRINTING_OF[subtype];
    const market = roundPrice(price);
    if (!printing || market == null || variants[printing]) continue;
    variants[printing] = { conditions: { NM: market, LP: null, MP: null, HP: null, DMG: null }, market, productId: null };
    added += 1;
  }
  if (!added) return grid;
  const base = grid || { source: "snapshot", graded: {}, defaultVariant: null };
  return { ...base, variants, updatedAt, spreadRatio: spreadOf(variants) };
}

/**
 * Replace TCGdex markets with the shared snapshot. The same object comes back when nothing matched,
 * so a missing product cannot change the date on screen.
 */
export function applySnapshot(grid, snapshot) {
  if (!grid || grid.source !== "tcgdex" || !snapshot?.prices) return grid;
  const updatedAt = typeof snapshot.updatedAt === "string" && Number.isFinite(Date.parse(snapshot.updatedAt))
    ? snapshot.updatedAt
    : null;
  if (!updatedAt) return grid;
  let applied = 0;
  const variants = {};
  for (const [printing, variant] of Object.entries(grid.variants || {})) {
    const subtype = SUBTYPE[printing];
    const product = snapshot.prices[String(variant?.productId)];
    const market = subtype && product ? roundPrice(product[subtype]) : null;
    if (market == null) {
      variants[printing] = variant;
      continue;
    }
    applied += 1;
    variants[printing] = {
      ...variant,
      market,
      conditions: { ...variant.conditions, NM: market },
    };
  }
  if (!applied) return grid;
  return { ...grid, variants, updatedAt, spreadRatio: spreadOf(variants) };
}

function chromeStorage() {
  return {
    get(key) {
      return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => resolve(result[key]));
      });
    },
    set(key, value) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    },
  };
}

/** @param {{ fetchImpl?: Function, storage?: { get: Function, set: Function }, now?: Function, url?: string, ttlMs?: number }} [deps] */
export function createSnapshotClient({
  fetchImpl = (...args) => fetch(...args),
  storage = null,
  now = Date.now,
  url = PRICE_SNAPSHOT_URL,
  ttlMs = SNAPSHOT_TTL_MS,
} = {}) {
  const store = storage || chromeStorage();
  let memory = null;
  let refreshing = null;
  let failUntil = 0;

  async function readStored() {
    if (memory && now() - memory.fetchedAt < ttlMs) return memory;
    const stored = await store.get(STORAGE_KEY);
    if (stored?.snapshot && Number.isFinite(stored.fetchedAt)) {
      memory = stored;
      return stored;
    }
    return null;
  }

  async function refreshOnce() {
    if (!url) return null;
    if (now() < failUntil) return (await readStored())?.snapshot ?? null;
    const stored = await readStored();
    if (stored && now() - stored.fetchedAt < ttlMs) return stored.snapshot;
    let snapshot;
    try {
      const response = await fetchImpl(url, {
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === NOT_PUBLISHED) {
        failUntil = now() + FAIL_MS;
        console.warn("[prices] snapshot not published yet (price-snapshot answered 404); keeping", stored ? "the last copy" : "TCGdex prices");
        return stored?.snapshot ?? null;
      }
      if (!response.ok) throw new Error(`price snapshot answered ${response.status}`);
      snapshot = parseSnapshot(await response.text());
    } catch (err) {
      failUntil = now() + FAIL_MS;
      console.error("[prices] snapshot not updated:", err?.message || err);
      return stored?.snapshot ?? null;
    }
    memory = { fetchedAt: now(), snapshot };
    try {
      await store.set(STORAGE_KEY, memory);
    } catch (err) {
      console.error("[prices] snapshot not stored:", err?.message || err);
    }
    return snapshot;
  }

  function refreshPriceSnapshot() {
    if (!refreshing) refreshing = refreshOnce().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function currentSnapshot() {
    const stored = await readStored();
    if (stored && now() - stored.fetchedAt < ttlMs) return stored.snapshot;
    return refreshPriceSnapshot();
  }

  return { currentSnapshot, refreshPriceSnapshot };
}

const client = createSnapshotClient();

export function currentSnapshot() {
  return client.currentSnapshot();
}

export function refreshPriceSnapshot() {
  return client.refreshPriceSnapshot();
}
