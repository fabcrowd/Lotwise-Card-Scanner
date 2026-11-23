import { LOT_COLUMN_COUNT, grid, pricedRow } from './helpers/rows';
import { createLibrary, libraryCsv, libraryTotal, savedPrice, searchLibrary } from '../src/data/library';
import { installPlatform } from '../src/platform/install';
import { memoryStore } from '../src/platform/storage';

beforeAll(() => installPlatform());

function clock(): () => number {
  let now = 1_800_000_000_000;
  return () => (now += 1000);
}

test('cards are added, listed newest first, updated and removed', async () => {
  const library = createLibrary(memoryStore(), clock());
  const first = await library.add({ row: pricedRow('base1-4', 'Charizard', { holofoil: 350 }), printing: null, cropUri: null });
  const second = await library.add({ row: pricedRow('base1-58', 'Pikachu', { normal: 4 }), printing: null, cropUri: 'file:///cards/p.jpg' });
  expect(first.key).not.toBe(second.key);
  expect((await library.all()).map((card) => card.key)).toEqual([second.key, first.key]);

  const updated = await library.update(first.key, { printing: 'holofoil' });
  expect(updated?.printing).toBe('holofoil');
  expect((await library.byKey(first.key))?.printing).toBe('holofoil');
  expect(await library.update('missing', { printing: 'x' })).toBeNull();

  await library.remove(second.key);
  expect((await library.all()).map((card) => card.key)).toEqual([first.key]);
});

test('changes made at the same moment are all kept', async () => {
  const library = createLibrary(memoryStore(), clock());
  const names = ['Charizard', 'Pikachu', 'Blastoise', 'Venusaur'];
  const saved = await Promise.all(names.map((name, i) => library.add({ row: pricedRow(`base1-${i + 1}`, name, { normal: i + 1 }), printing: null, cropUri: null })));
  expect(new Set(saved.map((card) => card.key)).size).toBe(4);
  expect(await library.all()).toHaveLength(4);
  await Promise.all([library.remove(saved[0].key), library.update(saved[1].key, { printing: 'normal' }), library.remove(saved[2].key)]);
  const left = await library.all();
  expect(left.map((card) => card.row.identity?.name).sort()).toEqual(['Pikachu', 'Venusaur']);
  expect(left.find((card) => card.key === saved[1].key)?.printing).toBe('normal');
});

test('a failed write does not block the changes after it', async () => {
  const store = memoryStore();
  const library = createLibrary(store, clock());
  const realSet = store.setItem;
  store.setItem = async () => { throw new Error('disk full'); };
  await expect(library.add({ row: pricedRow('base1-4', 'Charizard', { holofoil: 350 }), printing: null, cropUri: null })).rejects.toThrow('disk full');
  store.setItem = realSet;
  await library.add({ row: pricedRow('base1-58', 'Pikachu', { normal: 4 }), printing: null, cropUri: null });
  expect(await library.all()).toHaveLength(1);
});

test('the export counts the cards it leaves out for an out-of-date price', async () => {
  const library = createLibrary(memoryStore(), clock());
  const fresh = await library.add({ row: pricedRow('base1-58', 'Pikachu', { normal: 4 }), printing: null, cropUri: null });
  const old = await library.add({ row: { ...pricedRow('base1-4', 'Charizard', { holofoil: 350 }), price_grid: grid({ holofoil: 350 }, '2026-01-01T00:00:00Z') }, printing: null, cropUri: null });
  const result = libraryCsv([fresh, old], Date.parse('2026-11-15T12:00:00Z'));
  expect(result.count).toBe(1);
  expect(result.notIncluded).toBe(1);
});

test('the library survives a restart and a damaged file reads as empty', async () => {
  const store = memoryStore();
  await createLibrary(store, clock()).add({ row: pricedRow('base1-4', 'Charizard', { holofoil: 350 }), printing: null, cropUri: null });
  expect(await createLibrary(store).all()).toHaveLength(1);
  await store.setItem('library', '{damaged');
  expect(await createLibrary(store).all()).toEqual([]);
});

test('search matches every word against name, set and number', async () => {
  const library = createLibrary(memoryStore(), clock());
  await library.add({ row: pricedRow('base1-4', 'Charizard', { holofoil: 350 }), printing: null, cropUri: null });
  await library.add({ row: pricedRow('jungle-60', 'Pikachu', { normal: 4 }), printing: null, cropUri: null });
  const cards = await library.all();
  expect(searchLibrary(cards, 'pika jungle').map((card) => card.row.identity?.id)).toEqual(['jungle-60']);
  expect(searchLibrary(cards, 'BASE1')).toHaveLength(1);
  expect(searchLibrary(cards, '   ')).toHaveLength(2);
  expect(searchLibrary(cards, 'mewtwo')).toEqual([]);
});

test('a card with one printing has a price; with several, only once a printing is picked', async () => {
  const library = createLibrary(memoryStore(), clock());
  const single = await library.add({ row: pricedRow('base1-58', 'Pikachu', { normal: 4 }), printing: null, cropUri: null });
  const open = await library.add({ row: pricedRow('base1-4', 'Charizard', { holofoil: 350, normal: 90 }), printing: null, cropUri: null });
  expect(savedPrice(single)).toBe(4);
  expect(savedPrice(open)).toBeNull();
  expect(savedPrice({ ...open, printing: 'holofoil' })).toBe(350);
  expect(libraryTotal([single, open])).toBe(4);
  expect(libraryTotal([single, { ...open, printing: 'holofoil' }])).toBe(354);
});

test('the export is the extension lot CSV: its header, one row per card, the picked printing priced', async () => {
  const library = createLibrary(memoryStore(), clock());
  const zard = await library.add({ row: pricedRow('base1-4', 'Charizard', { holofoil: 350, normal: 90 }), printing: 'holofoil', cropUri: null });
  const pika = await library.add({ row: pricedRow('base1-58', 'Pikachu', { normal: 4 }), printing: null, cropUri: null });
  const { name, csv, count } = libraryCsv([zard, pika], Date.parse('2026-11-15T12:00:00Z'));
  const lines = csv.trimEnd().split('\r\n');
  expect(name).toMatch(/^card-lot-2026-11-1\d\.csv$/);
  expect(count).toBe(2);
  expect(lines[0].split(',')).toHaveLength(LOT_COLUMN_COUNT);
  expect(lines[0].startsWith('Name,Set,Number,Printing')).toBe(true);
  expect(lines.find((line) => line.startsWith('Charizard'))).toContain('350.00');
  expect(lines.find((line) => line.startsWith('Pikachu'))).toContain('4.00');
});

test('a card whose price failed is still listed and adds nothing to the total', async () => {
  const library = createLibrary(memoryStore(), clock());
  const row = { ...pricedRow('base1-4', 'Charizard', {}), price_grid: null, priceError: true };
  const saved = await library.add({ row, printing: null, cropUri: null });
  expect(savedPrice(saved)).toBeNull();
  expect(libraryTotal([saved])).toBe(0);
  expect(grid({}).variants).toEqual({});
});
