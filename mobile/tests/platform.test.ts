import { clearPptKey, getPptKey, parseCardNumber, parseSnapshot, physicalHits, savePptKey, searchCatalog } from '../src/core/ext';
import { GunzipStream, installPlatform } from '../src/platform/install';
import { createStorageArea, memoryStore, routedStore } from '../src/platform/storage';
import { card, loadAxisCatalog, queryFor } from './helpers/catalog';

const secure = memoryStore();
const plain = memoryStore();

beforeAll(() => installPlatform({ local: routedStore(['pptApiKey'], secure, plain) }));

describe('storage', () => {
  test('the callback form the pricing cache uses', (done) => {
    const area = createStorageArea(memoryStore());
    area.set({ price_x: { value: 4.5, ts: 1 } }, () => {
      area.get('price_x', (items) => {
        expect(items).toEqual({ price_x: { value: 4.5, ts: 1 } });
        done();
      });
    });
  });

  test('the promise form, with missing keys left out and defaults applied', async () => {
    const area = createStorageArea(memoryStore());
    await area.set({ a: 1, b: [2] });
    expect(await area.get(['a', 'missing'])).toEqual({ a: 1 });
    expect(await area.get({ b: null, c: 'fallback' })).toEqual({ b: [2], c: 'fallback' });
    await area.remove('a');
    expect(await area.get('a')).toEqual({});
  });

  test('a damaged record reads as missing', async () => {
    const store = memoryStore();
    await store.setItem('broken', '{not json');
    expect(await createStorageArea(store).get('broken')).toEqual({});
  });

  test("the extension's price-service key goes to the secure store and nowhere else", async () => {
    await savePptKey('key-123');
    expect(await getPptKey()).toBe('key-123');
    expect(await secure.getItem('pptApiKey')).toBe(JSON.stringify('key-123'));
    expect(await plain.getItem('pptApiKey')).toBeNull();
    await clearPptKey();
    expect(await getPptKey()).toBeNull();
    expect(await secure.getItem('pptApiKey')).toBeNull();
  });
});

describe('catalog', () => {
  const meta = [card('base1-4', 'Charizard', 'base1', '4'), card('A1-1', 'Pocket Card', 'A1', '1'), card('base1-2', 'Blastoise', 'base1', '2')];

  test("the extension's catalog loader reads a gzip file through the stand-in stream, and search ranks it", async () => {
    await loadAxisCatalog(meta.length);
    const hits = searchCatalog(queryFor({ 0: 0.2, 1: 0.9, 2: 0.4 }), 3);
    expect(hits.map((hit) => hit.index)).toEqual([1, 2, 0]);
    expect(hits[0].score).toBeCloseTo(0.9 / Math.hypot(0.2, 0.9, 0.4), 5);
    expect(physicalHits(hits, meta).map((hit) => meta[hit.index].id)).toEqual(['base1-2', 'base1-4']);
  });

  test('an unsupported compression format is refused', () => {
    expect(() => new GunzipStream('deflate')).toThrow(/Unsupported compression format/);
  });
});

describe('card text parsing', () => {
  test('the collector number is parsed from read lines', () => {
    expect(parseCardNumber(['Illus. Ken Sugimori', '58/102'])).toEqual({ number: '58', total: 102 });
    expect(parseCardNumber(['4/1O2'])).toEqual({ number: '4', total: 102 });
    expect(parseCardNumber(['no number here'])).toBeNull();
  });

  test('the daily price file is parsed, and a file without a date is refused', () => {
    const snapshot = parseSnapshot(JSON.stringify({ v: 1, updatedAt: '2026-11-14T06:00:00Z', prices: { 42: { market: 3.5 } } }));
    expect(snapshot.updatedAt).toBe('2026-11-14T06:00:00Z');
    expect(() => parseSnapshot(JSON.stringify({ v: 1, prices: {} }))).toThrow(/no date/);
    expect(() => parseSnapshot('')).toThrow();
  });
});

test('AbortSignal.timeout exists for the price fetches', () => {
  expect(typeof AbortSignal.timeout).toBe('function');
});
