import { confirmPick, createRecognizer } from '../src/core/recognize';
import type { CatalogCard } from '../src/core/types';
import { PixelCanvas } from '../src/platform/canvas';
import { installPlatform } from '../src/platform/install';
import { card, loadAxisCatalog, queryFor } from './helpers/catalog';

const TALL = 800;
const SMALL = 120;
const crop = new PixelCanvas(4, 4);

// Index 0 is the card the picture shows. 1 and 2 are two printings of one name. 3-5 are a three-card set whose size
// matches a "2/3" collector number. 6-28 are fillers that outrank index 29, which only the title can bring in.
const meta: CatalogCard[] = [
  card('base1-4', 'Charizard', 'base1', '4'),
  card('base1-58', 'Pikachu', 'base1', '58'),
  card('jungle-60', 'Pikachu', 'jungle', '60'),
  card('tiny-1', 'Bulbasaur', 'tiny', '1'),
  card('tiny-2', 'Squirtle', 'tiny', '2'),
  card('tiny-3', 'Squirtle', 'tiny', '3'),
  ...Array.from({ length: 23 }, (_, i) => card(`fill-${i}`, `Filler Number ${i}`, `fill${i}`, String(i + 1))),
  card('promo-9', 'Dragonite', 'promo', '9'),
];

const charizardPhoto = queryFor({ 0: 0.9, ...Object.fromEntries(Array.from({ length: 23 }, (_, i) => [6 + i, 0.05])) });

beforeAll(async () => {
  installPlatform();
  await loadAxisCatalog(meta.length);
});

test('a strong picture match is offered first but still waits for the user', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => charizardPhoto });
  const row = await recognize(crop, TALL);
  expect(row.identity?.id).toBe('base1-4');
  expect(row.pictureConfirmed).toBe(true);
  expect(row.unsure).toBe(true);
  expect(row.userConfirmed).toBeUndefined();
  expect(row.candidates?.[0].id).toBe('base1-4');
  expect(row.price_grid).toBeNull();
  expect(row.market_price).toBeNull();
});

test('a small crop is never a strong match', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => charizardPhoto });
  const row = await recognize(crop, SMALL);
  expect(row.pictureConfirmed).toBe(false);
  expect(row.candidates?.[0].id).toBe('base1-4');
});

test('two printings that look alike: the scanner does not guess, and both lead the list', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => queryFor({ 1: 0.71, 2: 0.7 }) });
  const row = await recognize(crop, TALL);
  expect(row.abstain).toBe(true);
  expect(row.pictureConfirmed).toBe(false);
  expect(row.candidates?.map((candidate) => candidate.id).slice(0, 2)).toEqual(['base1-58', 'jungle-60']);
});

test('a printing that looks clearly closest is the guess, with its set marked unconfirmed', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => queryFor({ 1: 0.9, 2: 0.3 }) });
  const row = await recognize(crop, TALL);
  expect(row.identity?.id).toBe('base1-58');
  expect(row.setUnconfirmed).toBe(true);
  expect(row.setChoices).toBeUndefined();
});

test('a title that agrees is recorded and changes nothing else', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => charizardPhoto, readName: async () => 'Charizard 120 HP' });
  const row = await recognize(crop, TALL);
  expect(row.titleConfirmed).toBe(true);
  expect(row.identity?.id).toBe('base1-4');
  expect(row.pictureConfirmed).toBe(true);
});

test('a title naming a card outside the closest matches puts that card in the list', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => charizardPhoto, readName: async () => 'Dragonite 100 HP' });
  const row = await recognize(crop, TALL);
  expect(row.titleContradicts).toBe('Dragonite');
  expect(row.titleChoices).toEqual(['promo-9']);
  expect(row.pictureConfirmed).toBe(false);
  const ids = row.candidates?.map((candidate) => candidate.id) ?? [];
  expect(ids[0]).toBe('base1-4');
  expect(ids).toContain('promo-9');
});

test('when the picture names nothing, the title only adds its card to the list', async () => {
  const unsurePhoto = queryFor({ 0: 0.3, ...Object.fromEntries(Array.from({ length: 23 }, (_, i) => [6 + i, 0.2])) });
  const { recognize } = createRecognizer({ meta, embed: async () => unsurePhoto, readName: async () => 'Dragonite 100 HP' });
  const row = await recognize(crop, TALL);
  expect(row.abstain).toBe(true);
  expect(row.titleChoices).toEqual(['promo-9']);
  expect(row.titleContradicts).toBeUndefined();
  const ids = row.candidates?.map((candidate) => candidate.id) ?? [];
  expect(ids[0]).toBe('base1-4');
  expect(ids).toContain('promo-9');
});

test('a title naming one of the closest matches makes that card the guess', async () => {
  const { recognize } = createRecognizer({ meta, embed: async () => queryFor({ 0: 0.9, 3: 0.3 }), readName: async () => 'Bulbasaur 40 HP' });
  const row = await recognize(crop, TALL);
  expect(row.identity?.id).toBe('tiny-1');
  expect(row.titleReranked).toBe(true);
  expect(row.pictureConfirmed).toBe(false);
});

test('the title is not read from a small crop', async () => {
  const readName = jest.fn(async () => 'Dragonite');
  const { recognize } = createRecognizer({ meta, embed: async () => charizardPhoto, readName });
  const row = await recognize(crop, SMALL);
  expect(readName).not.toHaveBeenCalled();
  expect(row.titleContradicts).toBeUndefined();
});

test('the collector number settles the printing among same-name cards', async () => {
  const { recognize } = createRecognizer({
    meta,
    embed: async () => queryFor({ 4: 0.7, 5: 0.7 }),
    readNumber: async () => ({ text: '2/3', number: '2', total: 3 }),
  });
  const row = await recognize(crop, TALL);
  expect(row.identity?.id).toBe('tiny-2');
  expect(row.numberRead).toBe('2/3');
  expect(row.setChoices).toBeUndefined();
});

test('a failed text read is logged and the picture result stands', async () => {
  const log = jest.fn();
  const { recognize } = createRecognizer({
    meta,
    embed: async () => charizardPhoto,
    readName: async () => { throw new Error('model missing'); },
    readNumber: async () => { throw new Error('model missing'); },
    log,
  });
  const row = await recognize(crop, TALL);
  expect(row.identity?.id).toBe('base1-4');
  expect(log).toHaveBeenCalledWith(expect.stringContaining('title read failed'));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('number read failed'));
});

test('confirming a pick names the card, settles it and clears any earlier price', async () => {
  const { recognize, catalogCard } = createRecognizer({ meta, embed: async () => queryFor({ 1: 0.8, 2: 0.6 }) });
  const open = await recognize(crop, TALL);
  const picked = confirmPick({ ...open, market_price: 3, priceError: true }, catalogCard('jungle-60') as CatalogCard);
  expect(picked.identity?.id).toBe('jungle-60');
  expect(picked.userConfirmed).toBe(true);
  expect(picked.unsure).toBe(false);
  expect(picked.pricing).toBe(true);
  expect(picked.setChoices).toBeUndefined();
  expect(picked.priceError).toBeUndefined();
  expect(picked.market_price).toBeNull();
});
