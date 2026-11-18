import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sourceName } from '../tools/extension-wasm/lib/card-display.js';
import { JA_PRICE_TTL_MS, createJaPriceClient, fromTcgcsvPrices, jaLookup, parsePriceRows } from '../tools/extension-wasm/lib/ja-prices.js';

const FETCHED = Date.parse('2026-11-17T10:00:00.000Z');
const row = (over) => ({ productId: 709157, marketPrice: 1.5, midPrice: 1.2, subTypeName: 'Normal', ...over });

test('one priced printing becomes the default variant with only NM filled', () => {
  const grid = fromTcgcsvPrices([row(), row({ productId: 5, marketPrice: 99 })], 709157, FETCHED);
  assert.equal(grid.source, 'tcgcsv');
  assert.deepEqual(Object.keys(grid.variants), ['normal']);
  assert.deepEqual(grid.variants.normal, { conditions: { NM: 1.5, LP: null, MP: null, HP: null, DMG: null }, market: 1.5 });
  assert.equal(grid.defaultVariant, 'normal');
  assert.equal(grid.spreadRatio, 1);
  assert.deepEqual(grid.graded, {});
  assert.equal(grid.updatedAt, '2026-11-17T10:00:00.000Z');
});

test('two printings get camel-cased keys, the holofoil default and a spread', () => {
  const grid = fromTcgcsvPrices([
    row({ subTypeName: 'Reverse Holofoil', marketPrice: 3 }),
    row({ subTypeName: 'Holofoil', marketPrice: 6 }),
  ], 709157, FETCHED);
  assert.deepEqual(Object.keys(grid.variants).sort(), ['holofoil', 'reverseHolofoil']);
  assert.equal(grid.defaultVariant, 'holofoil');
  assert.equal(grid.spreadRatio, 2);
});

test('another printing name is camel-cased', () => {
  const grid = fromTcgcsvPrices([row({ subTypeName: '1st Edition Holofoil', marketPrice: 8 })], 709157, FETCHED);
  assert.deepEqual(Object.keys(grid.variants), ['1stEditionHolofoil']);
  assert.equal(grid.variants['1stEditionHolofoil'].market, 8);
  assert.equal(fromTcgcsvPrices([row({ subTypeName: 'Poke Ball Pattern' })], 709157, FETCHED).defaultVariant, 'pokeBallPattern');
});

test('the middle-of-listings price is never shown as the market price: no market price, no price', () => {
  assert.equal(fromTcgcsvPrices([row({ marketPrice: null, midPrice: 8 })], 709157, FETCHED), null);
  assert.equal(fromTcgcsvPrices([row({ marketPrice: undefined, midPrice: 8 })], 709157, FETCHED), null);
});

test('malformed rows give no price: string ids, negative, zero, non-finite and missing fields', () => {
  const bad = [
    row({ productId: '709157' }),
    row({ marketPrice: -1 }),
    row({ marketPrice: 0 }),
    row({ marketPrice: '1.5' }),
    row({ marketPrice: NaN }),
    row({ marketPrice: Infinity }),
    { productId: 709157 },
    { marketPrice: 2 },
    null, 'x', 5,
  ];
  for (const one of bad) assert.equal(fromTcgcsvPrices([one], 709157, FETCHED), null, JSON.stringify(one));
  assert.equal(parsePriceRows(bad).length, 0);
  assert.equal(parsePriceRows({ results: [] }).length, 0);
  // A good row among bad ones still prices; a missing printing name is a normal printing.
  const grid = fromTcgcsvPrices([...bad, { productId: 709157, marketPrice: 2.5 }], 709157, FETCHED);
  assert.deepEqual(Object.keys(grid.variants), ['normal']);
  assert.equal(grid.variants.normal.market, 2.5);
});

test('parsePriceRows keeps only what the price needs', () => {
  assert.deepEqual(parsePriceRows([row({ extra: 'x', lowPrice: 1 })]), [{ productId: 709157, subTypeName: 'Normal', marketPrice: 1.5 }]);
});

test('jaLookup says a failed lookup failed, and an answer with no price is not a failure', async () => {
  const identity = { id: 'jp-709157', tcgPlayerId: 709157, groupId: 24791 };
  const failed = await jaLookup(identity, { groupPrices: async () => null }, FETCHED);
  assert.equal(failed.failed, true);
  assert.equal(failed.result.price_grid, null);
  const empty = await jaLookup(identity, { groupPrices: async () => [] }, FETCHED);
  assert.equal(empty.failed, false);
  const good = await jaLookup(identity, { groupPrices: async () => [row()] }, FETCHED);
  assert.equal(good.failed, false);
  assert.equal(good.result.market_price, 1.5);
});

test('a product with no usable price has no grid', () => {
  assert.equal(fromTcgcsvPrices([row({ marketPrice: null, midPrice: null })], 709157, FETCHED), null);
  assert.equal(fromTcgcsvPrices([row({ marketPrice: 0, midPrice: 0 })], 709157, FETCHED), null);
  assert.equal(fromTcgcsvPrices([row({ productId: 1 })], 709157, FETCHED), null);
  assert.equal(fromTcgcsvPrices([], 709157, FETCHED), null);
  assert.equal(fromTcgcsvPrices(null, 709157, FETCHED), null);
});

test('jaLookup: the default variant gives the market price, from the identity\'s own group and product', async () => {
  const asked = [];
  const client = { groupPrices: async (group) => { asked.push(group); return [row({ subTypeName: 'Holofoil', marketPrice: 6 }), row({ marketPrice: 2 })]; } };
  const { result: out, failed } = await jaLookup({ id: 'jp-709157', tcgPlayerId: 709157, groupId: 24791 }, client, FETCHED);
  assert.equal(failed, false);
  assert.deepEqual(asked, [24791]);
  assert.equal(out.market_price, 6);
  assert.equal(out.price_variant, 'holofoil');
  assert.equal(out.price_grid.source, 'tcgcsv');
  assert.equal(out.price_grid.updatedAt, '2026-11-17T10:00:00.000Z');
});

test('jaLookup: no answer or no usable price gives an empty price, never another source', async () => {
  const none = { market_price: null, price_variant: null, price_grid: null };
  const identity = { id: 'jp-709157', tcgPlayerId: 709157, groupId: 24791 };
  assert.deepEqual((await jaLookup(identity, { groupPrices: async () => null }, FETCHED)).result, none);
  assert.deepEqual((await jaLookup(identity, { groupPrices: async () => [row({ marketPrice: null })] }, FETCHED)).result, none);
});

test('the price source is shown as TCGPlayer', () => {
  assert.equal(sourceName({ source: 'tcgcsv' }), 'TCGPlayer');
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const ok = (results) => ({ ok: true, json: async () => ({ results }) });

test('a group is asked for at tcgcsv.com with a time limit', async () => {
  const fetchFn = fakeFetch(() => ok([row()]));
  const client = createJaPriceClient({ fetchFn });
  assert.deepEqual(await client.groupPrices(24791), [{ productId: 709157, subTypeName: 'Normal', marketPrice: 1.5 }]);
  assert.equal(fetchFn.calls[0].url, 'https://tcgcsv.com/tcgplayer/85/24791/prices');
  assert.ok(fetchFn.calls[0].init.signal instanceof AbortSignal);
});

test('a group is cached for six hours', async () => {
  let t = 1_000_000;
  const fetchFn = fakeFetch(() => ok([row()]));
  const client = createJaPriceClient({ fetchFn, now: () => t });
  await client.groupPrices(1);
  t += JA_PRICE_TTL_MS - 1;
  await client.groupPrices(1);
  assert.equal(fetchFn.calls.length, 1);
  t += 1;
  await client.groupPrices(1);
  assert.equal(fetchFn.calls.length, 2);
  await client.groupPrices(2);
  assert.equal(fetchFn.calls.length, 3);
});

test('two concurrent calls for one group make one request', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchFn = fakeFetch(async () => { await gate; return ok([row()]); });
  const client = createJaPriceClient({ fetchFn });
  const both = Promise.all([client.groupPrices(9), client.groupPrices(9)]);
  release();
  const [a, b] = await both;
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(a, b);
});

test('a failure returns null and is not cached', async () => {
  const answers = [() => { throw new Error('offline'); }, () => ({ ok: false }), () => ({ ok: true, json: async () => ({ nope: 1 }) }), () => ok([row()])];
  const fetchFn = fakeFetch((_url, n) => answers[n - 1]());
  const client = createJaPriceClient({ fetchFn });
  assert.equal(await client.groupPrices(3), null);
  assert.equal(await client.groupPrices(3), null);
  assert.equal(await client.groupPrices(3), null);
  assert.deepEqual(await client.groupPrices(3), parsePriceRows([row()]));
  assert.equal(fetchFn.calls.length, 4);
});

test('expired groups are dropped when a new one is stored, and only parsed rows are kept', async () => {
  let t = 1_000_000;
  const fetchFn = fakeFetch(() => ok([row({ extra: 'x'.repeat(1000) }), row({ marketPrice: -1 })]));
  const client = createJaPriceClient({ fetchFn, now: () => t });
  await client.groupPrices(1);
  await client.groupPrices(2);
  assert.equal(client.size(), 2);
  t += JA_PRICE_TTL_MS;
  await client.groupPrices(3);
  assert.equal(client.size(), 1, 'groups 1 and 2 expired and went');
  assert.deepEqual(await client.groupPrices(3), [{ productId: 709157, subTypeName: 'Normal', marketPrice: 1.5 }]);
});
