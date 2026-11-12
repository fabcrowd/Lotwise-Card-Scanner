import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_CATALOG_CARDS, MAX_STAMPED_ROWS, applyCatalogPrices, applySnapshot, parseSnapshot } from '../tools/extension-wasm/lib/price-snapshot.js';
import { applySetStamp } from '../tools/extension-wasm/lib/set-stamp.js';
import { detectedVariant, isGridStale, isIdentified, quotedPrice } from '../tools/extension-wasm/lib/card-display.js';

// The nightly prices.json (live since 2026-10-25) adds `byCatalog` (ex10-ex16 prices by catalog id, for cards TCGdex
// has no product id or reverse price for) and `stamped` (stamped products, for the Stamp-choice phase).
// Fixture: a trimmed copy of the live file (public TCGplayer prices).
const FIXTURE = readFileSync(new URL('./fixtures/prices-snapshot-v1-trimmed.json', import.meta.url), 'utf8');
const UPDATED = '2026-10-24T20:05:44Z';
const NOW = Date.parse('2026-10-25T17:00:00Z');
const AERO_LM = { id: 'ex12-1', name: 'Aerodactyl', set: 'Legend Maker', setCode: 'ex12', number: '1' };

// What TCGdex gives ex12-1: a holo price, no reverse holo price (TCGdex 2026-10-14).
const tcgdexHoloOnly = () => ({
  source: 'tcgdex', updatedAt: '2026-10-14T22:55:09.651Z', spreadRatio: 1, graded: {},
  variants: { holofoil: { productId: 83468, market: 75.2, conditions: { NM: 75.2, LP: null, MP: null, HP: null, DMG: null } } },
});

test('the snapshot keeps byCatalog and stamped; a file without them still parses', () => {
  const snapshot = parseSnapshot(FIXTURE);
  assert.equal(snapshot.updatedAt, UPDATED);
  assert.deepEqual({ ...snapshot.byCatalog['ex12-1'] }, { Holofoil: 75.96, 'Reverse Holofoil': 162.49 });
  assert.deepEqual({ ...snapshot.byCatalog['ex10-101'] }, { Holofoil: 151.11 });
  assert.equal(snapshot.stamped.length, 3);
  assert.deepEqual({ ...snapshot.stamped[1] }, {
    catalogId: 'ex11-64', stamp: 'setlogo', tag: 'Squirtle Delta Species Stamped', productId: 693054,
    subtype: 'Reverse Holofoil', market: null, mid: 400, low: 249.99,
  });
  assert.ok(!('_note' in snapshot));
  const old = parseSnapshot(JSON.stringify({ v: 1, updatedAt: UPDATED, prices: { 1: { Holofoil: 2 } } }));
  assert.deepEqual({ ...old.byCatalog }, {});
  assert.deepEqual([...old.stamped], []);
});

test('bad byCatalog and stamped entries are dropped, never fatal; an oversized section is dropped whole', () => {
  const parse = (extra) => parseSnapshot(JSON.stringify({ v: 1, updatedAt: UPDATED, prices: { 1: { Holofoil: 2 } }, ...extra }));
  const mixed = parse({
    byCatalog: {
      'ex12-1': { Holofoil: 75.96, 'Reverse Holofoil': -1, Shiny: 9, Normal: 'x' },
      'ex12-2': 'nope',
      'not an id!': { Holofoil: 1 },
      'ex12-3': {},
    },
    stamped: [
      { catalogId: 'ex11-64', stamp: 'setlogo', tag: 'x', productId: 693054, subtype: 'Reverse Holofoil', market: 1, mid: null, low: null },
      { catalogId: 'ex11-64', stamp: 'setlogo', tag: 'x', productId: -5, subtype: 'Reverse Holofoil', market: 1 },
      { catalogId: 'ex11-64', stamp: 'Set Logo!', tag: 'x', productId: 5, subtype: 'Reverse Holofoil', market: 1 },
      { catalogId: 'ex11-64', stamp: 'setlogo', tag: 42, productId: 5, subtype: 'Reverse Holofoil', market: 1 },
      'row',
      // A Prize Pack product (the whole group is stamped) has no tag.
      { catalogId: 'me01-003', stamp: 'playpokemon', tag: null, productId: 671669, subtype: 'Holofoil', market: 8.22, mid: 8.47, low: 6.5 },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(mixed.byCatalog)), { 'ex12-1': { Holofoil: 75.96 } });
  assert.equal(mixed.stamped.length, 2);
  assert.equal(mixed.stamped[1].tag, null);
  assert.deepEqual(Object.keys(mixed.prices), ['1']);
  assert.deepEqual({ ...parse({ byCatalog: [1, 2], stamped: { a: 1 } }).byCatalog }, {});
  assert.deepEqual([...parse({ byCatalog: [1, 2], stamped: { a: 1 } }).stamped], []);
  const many = Object.fromEntries(Array.from({ length: MAX_CATALOG_CARDS + 1 }, (_, i) => [`ex12-${i}`, { Holofoil: 1 }]));
  assert.deepEqual({ ...parse({ byCatalog: many }).byCatalog }, {});
  const rows = Array.from({ length: MAX_STAMPED_ROWS + 1 }, () => ({ catalogId: 'a-1', stamp: 'staff', tag: 't', productId: 1, subtype: 'Holofoil', market: 1 }));
  assert.deepEqual([...parse({ stamped: rows }).stamped], []);
  // The size and date rules are unchanged.
  assert.throws(() => parseSnapshot('x'.repeat(8_000_001)), /too large/);
  assert.throws(() => parseSnapshot(JSON.stringify({ v: 1, prices: {}, byCatalog: {} })), /no date/);
});

test('byCatalog fills the missing Reverse Holofoil price of an ex12 card, with the snapshot\'s date', () => {
  const snapshot = parseSnapshot(FIXTURE);
  const filled = applyCatalogPrices(applySnapshot(tcgdexHoloOnly(), snapshot), snapshot, AERO_LM);
  assert.equal(filled.variants.reverseHolofoil.market, 162.49);
  assert.equal(filled.variants.reverseHolofoil.conditions.NM, 162.49);
  assert.equal(filled.variants.reverseHolofoil.conditions.LP, null);
  assert.equal(filled.variants.holofoil.market, 75.2, 'a TCGdex printing is not replaced by byCatalog');
  assert.equal(filled.updatedAt, UPDATED);
  assert.equal(filled.spreadRatio, 162.49 / 75.2);
  assert.equal(filled.source, 'tcgdex');
  // No TCGdex grid at all: the card gets its grid from byCatalog.
  const built = applyCatalogPrices(null, snapshot, { id: 'ex15-3', name: 'Flygon', setCode: 'ex15', number: '3' });
  assert.deepEqual(Object.keys(built.variants).sort(), ['holofoil', 'reverseHolofoil']);
  assert.equal(built.variants.reverseHolofoil.market, 104.84);
  assert.equal(built.updatedAt, UPDATED);
  assert.equal(built.source, 'snapshot');
});

test('byCatalog leaves every other card, a richer grid and an undated snapshot alone', () => {
  const snapshot = parseSnapshot(FIXTURE);
  const holo = tcgdexHoloOnly();
  assert.equal(applyCatalogPrices(holo, snapshot, { ...AERO_LM, id: 'ex12-99' }), holo, 'no byCatalog entry');
  assert.equal(applyCatalogPrices(holo, snapshot, { id: 'ex9-1', setCode: 'ex9' }), holo, 'not ex10-ex16');
  assert.equal(applyCatalogPrices(null, snapshot, { id: 'ex9-1', setCode: 'ex9' }), null);
  const tracker = { ...tcgdexHoloOnly(), source: 'ppt' };
  assert.equal(applyCatalogPrices(tracker, snapshot, AERO_LM), tracker);
  assert.equal(applyCatalogPrices(holo, { ...snapshot, updatedAt: 'soon' }, AERO_LM), holo);
  assert.equal(applyCatalogPrices(holo, null, AERO_LM), holo);
  assert.equal(applyCatalogPrices(holo, { v: 1, updatedAt: UPDATED, prices: {} }, AERO_LM), holo, 'an older stored snapshot without byCatalog');
  const full = { ...tcgdexHoloOnly(), variants: { ...tcgdexHoloOnly().variants, reverseHolofoil: { productId: 83468, market: 125, conditions: { NM: 125 } } } };
  assert.equal(applyCatalogPrices(full, snapshot, AERO_LM), full, 'nothing missing');
});

test('a byCatalog price from an old snapshot is stale, like any snapshot price', () => {
  const old = parseSnapshot(JSON.stringify({ ...JSON.parse(FIXTURE), updatedAt: '2026-09-01T00:00:00Z' }));
  const filled = applyCatalogPrices(tcgdexHoloOnly(), old, AERO_LM);
  assert.equal(filled.updatedAt, '2026-09-01T00:00:00Z');
  assert.equal(isGridStale(filled, NOW), true);
  assert.equal(isGridStale(applyCatalogPrices(tcgdexHoloOnly(), parseSnapshot(FIXTURE), AERO_LM), NOW), false);
});

test('an ex12 stamped card now confirms with the byCatalog Reverse Holofoil price', async () => {
  const snapshot = parseSnapshot(FIXTURE);
  const read = {
    identity: { id: 'ex7-1', name: 'Aerodactyl', setCode: 'ex7', number: '1' }, confidence: 0.9, abstain: false,
    variant: { edition: null, finish: null, stamp: 'setstamp' },
  };
  const card = await applySetStamp(read, 'LEGEND MAKER', {
    cardsInSet: (setCode) => (setCode === 'ex12' ? [AERO_LM] : []),
    catalogCard: () => undefined,
    priceIdentity: async (identity) => ({ price_grid: applyCatalogPrices(applySnapshot(tcgdexHoloOnly(), snapshot), snapshot, identity), market_price: null }),
  });
  assert.equal(card.identity.id, 'ex12-1');
  assert.equal(card.finishSure, 'reverse');
  assert.equal(detectedVariant(card), 'reverseHolofoil');
  assert.equal(isIdentified(card), true);
  assert.equal(quotedPrice(card, detectedVariant(card)).price, 162.49);
});

test('D14: a Dragon Frontiers stamp moves a "Pinsir" read to ex15 Pinsir δ, priced from byCatalog\'s Reverse Holofoil', async () => {
  const snapshot = parseSnapshot(FIXTURE);
  const PINSIR_DF = { id: 'ex15-9', name: 'Pinsir δ', set: 'Dragon Frontiers', setCode: 'ex15', number: '9' };
  const read = {
    identity: { id: 'sm8-4', name: 'Pinsir', set: 'Lost Thunder', setCode: 'sm8', number: '4' }, confidence: 0.79, abstain: false,
    setChoices: [{ id: 'sm8-4', setCode: 'sm8' }, { id: 'swsh7-1', setCode: 'swsh7' }],
    variant: { edition: null, finish: null, stamp: 'setstamp' },
  };
  const card = await applySetStamp(read, 'DRAGON FRONTIERS', {
    cardsInSet: (setCode) => (setCode === 'ex15' ? [PINSIR_DF] : []),
    catalogCard: () => undefined,
    // TCGdex has no TCGplayer price for this card: the grid comes from byCatalog alone.
    priceIdentity: async (identity) => ({ price_grid: applyCatalogPrices(null, snapshot, identity), market_price: null }),
  });
  assert.equal(card.identity.id, 'ex15-9');
  assert.equal(card.finishSure, 'reverse');
  assert.equal(detectedVariant(card), 'reverseHolofoil');
  assert.equal(quotedPrice(card, detectedVariant(card)).price, 48.98);
  assert.equal(card.price_grid.updatedAt, UPDATED);
});

test('the scanner fills EX grids from byCatalog before the pokemontcg.io fallback', () => {
  const background = readFileSync(new URL('../tools/extension-wasm/background.js', import.meta.url), 'utf8');
  assert.match(background, /applyCatalogPrices\(tcgdexGrid \? applySnapshot\(tcgdexGrid, snapshot\) : null, snapshot, identity\)/);
});
