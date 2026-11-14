import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICE_CACHE_PREFIX, PRICE_CACHE_TTL_MS, PRICE_ERROR_TEXT, applyBatchedPrices, batchPriceCards, createPriceCache,
  collectBatchIds, createRetryLoader,
} from '../tools/extension-wasm/lib/batch-price.js';
import { setRangeSummary } from '../tools/extension-wasm/lib/card-display.js';

const grid = (variants) => ({ source: 'tcgdex', variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { market: v, conditions: { NM: v } }])) });
const NONE = { market_price: null, price_variant: null, price_grid: null };

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}

// H1
test('H1: a stamped card whose set has no reverse price keeps no price after the batch', () => {
  const card = { identity: { id: 'ex12-1', setCode: 'ex12' }, stampSet: 'ex12', market_price: null, price_grid: { variants: {} } };
  const map = new Map([['ex12-1', { market_price: 75.2, price_variant: 'holofoil', price_grid: grid({ holofoil: 75.2 }) }]]);
  applyBatchedPrices([card], map, { setRangeSummary: () => null });
  assert.equal(card.market_price, null);
  assert.equal(card.price_variant, null);
  assert.deepEqual(card.price_grid.variants, {});
});

test('H1: a stamped card whose set has a reverse price gets it', () => {
  const card = { identity: { id: 'ex12-1', setCode: 'ex12' }, stampSet: 'ex12' };
  const price = { market_price: 125, price_variant: 'reverseHolofoil', price_grid: grid({ holofoil: 75.2, reverseHolofoil: 125 }) };
  applyBatchedPrices([card], new Map([['ex12-1', price]]), { setRangeSummary: () => null });
  assert.equal(card.market_price, 125);
  assert.ok(card.price_grid.variants.reverseHolofoil);
});

test('H1: an unstamped card gets the raw price', () => {
  const card = { identity: { id: 'a', setCode: 'x' } };
  const price = { market_price: 3, price_variant: 'holofoil', price_grid: grid({ holofoil: 3 }) };
  applyBatchedPrices([card], new Map([['a', price]]), { setRangeSummary: () => null });
  assert.equal(card.market_price, 3);
});

// M1
test('M1: a result with no price and no grid is not cached; a priced one is', async () => {
  const storage = fakeStorage();
  const cache = createPriceCache(storage);
  const prices = { a: NONE, b: { market_price: null, price_variant: null, price_grid: grid({}) }, c: { market_price: 2, price_variant: 'normal', price_grid: null }, d: { market_price: null, price_variant: null, price_grid: grid({ normal: 1 }) } };
  const map = await batchPriceCards(['a', 'b', 'c', 'd'], { cache, catalogCard: (id) => ({ id }), priceIdentity: async ({ id }) => prices[id] });
  assert.equal(map.size, 4);
  assert.deepEqual(Object.keys(storage.data).sort(), [PRICE_CACHE_PREFIX + 'c', PRICE_CACHE_PREFIX + 'd']);
});

// M2
test('M2: an expired entry is deleted when read; a fresh one is returned', async () => {
  let t = 1_000_000;
  const storage = fakeStorage({
    [PRICE_CACHE_PREFIX + 'old']: { value: { market_price: 1 }, ts: t - PRICE_CACHE_TTL_MS - 1 },
    [PRICE_CACHE_PREFIX + 'new']: { value: { market_price: 2 }, ts: t },
  });
  const cache = createPriceCache(storage, { now: () => t });
  assert.equal(await cache.get('old'), null);
  assert.ok(!(PRICE_CACHE_PREFIX + 'old' in storage.data));
  assert.deepEqual(await cache.get('new'), { market_price: 2 });
});

test('M2: pruneOnce removes expired priceCache_ keys only, and runs once', async () => {
  const t = 10_000_000;
  const storage = fakeStorage({
    [PRICE_CACHE_PREFIX + 'old']: { value: {}, ts: 0 },
    [PRICE_CACHE_PREFIX + 'new']: { value: {}, ts: t },
    other: { ts: 0 },
  });
  const cache = createPriceCache(storage, { now: () => t });
  await cache.pruneOnce();
  assert.deepEqual(Object.keys(storage.data).sort(), ['other', PRICE_CACHE_PREFIX + 'new']);
  storage.data[PRICE_CACHE_PREFIX + 'old2'] = { value: {}, ts: 0 };
  await cache.pruneOnce();
  assert.ok(PRICE_CACHE_PREFIX + 'old2' in storage.data, 'second call is a no-op');
});

// M3
test('M3: a thrown priceIdentity marks priceError and is not cached; no price is not an error', async () => {
  const storage = fakeStorage();
  const cache = createPriceCache(storage);
  const map = await batchPriceCards(['boom', 'empty'], {
    cache, catalogCard: (id) => ({ id }),
    priceIdentity: async ({ id }) => { if (id === 'boom') throw new Error('net'); return NONE; },
  });
  assert.equal(map.get('boom').priceError, PRICE_ERROR_TEXT);
  assert.equal(map.get('empty').priceError, undefined);
  assert.deepEqual(Object.keys(storage.data), []);

  const card = { identity: { id: 'boom' }, setChoices: [{ id: 'boom' }, { id: 'empty' }] };
  applyBatchedPrices([card], map, { setRangeSummary: () => null });
  assert.equal(card.priceError, PRICE_ERROR_TEXT);
  assert.equal(card.setChoices[0].priceError, PRICE_ERROR_TEXT);
  assert.equal(card.setChoices[1].priceError, undefined);
});

// Regression: version choices carry their own set choices and range (HEAD's ownSetState behavior)
test('versionChoices set choices are collected, priced, and given a setRange', () => {
  const card = { identity: { id: 'top' }, versionChoices: [{ id: 'v1', setChoices: [{ id: 'a' }, { id: 'b' }] }, { id: 'v2' }] };
  assert.deepEqual([...collectBatchIds([card])].sort(), ['a', 'b', 'top', 'v1', 'v2']);
  const pa = { market_price: 4, price_variant: 'normal', price_grid: grid({ normal: 4 }) };
  const pb = { market_price: 20, price_variant: 'normal', price_grid: grid({ normal: 20 }) };
  const map = new Map([['a', pa], ['b', pb]]);
  applyBatchedPrices([card], map, { setRangeSummary });
  const vc = card.versionChoices[0];
  assert.equal(vc.setChoices[0].market_price, 4);
  assert.equal(vc.setChoices[1].market_price, 20);
  assert.deepEqual(vc.setRange, setRangeSummary([pa, pb]));
  assert.ok(vc.setRange, 'range is non-empty');
  assert.equal(card.versionChoices[1].setRange, undefined);
});

test('collectBatchIds covers identity, versionChoices, setChoices and ignores missing ids', () => {
  const card = { identity: { id: 'i' }, versionChoices: [{ id: 'v' }], setChoices: [{ id: 's' }, {}] };
  assert.deepEqual([...collectBatchIds([card, { abstain: true }])].sort(), ['i', 's', 'v']);
});

// Gap tests
test('an id with no catalog card gets no price and no priceError', async () => {
  const map = await batchPriceCards(['ghost'], { cache: createPriceCache(fakeStorage()), catalogCard: () => null, priceIdentity: async () => { throw new Error('unused'); } });
  assert.equal(map.get('ghost').priceError, undefined);
  assert.equal(map.get('ghost').market_price, null);
});

test('createRetryLoader: concurrent calls share one load', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = createRetryLoader(async () => { calls++; await gate; });
  const a = run();
  const b = run();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

// M4
test('M4: a failed load retries on a later call, but not within 60 s', async () => {
  let t = 0;
  let calls = 0;
  const run = createRetryLoader(async () => { calls++; if (calls === 1) throw new Error('fetch failed'); }, { now: () => t });
  await run();
  assert.equal(calls, 1);
  t = 30_000;
  await run();
  assert.equal(calls, 1, 'within 60 s: no retry');
  t = 61_000;
  await run();
  assert.equal(calls, 2, 'after 60 s: retried');
  await run();
  assert.equal(calls, 2, 'a success stays loaded');
});
