import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_DATA_NOTE_KEY, nextCardDataNote, cardDataNoteText, dismissedNote,
} from '../tools/extension-wasm/lib/card-data-note.js';
import { mergeExtra, parseCatalogExtra } from '../tools/extension-wasm/lib/bundle.js';

// New-card entries as the worker holds them (parseCatalogExtra): the set name is in `set`, the set code in `setCode`.
const many = (n, set = 'A') => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, set, setCode: 'code' }));

test('the storage key is cardDataNote', () => {
  assert.equal(CARD_DATA_NOTE_KEY, 'cardDataNote');
});

test('first bundle with cards stores a fresh, undismissed note', () => {
  const note = nextCardDataNote(undefined, { seq: 5, cards: many(3), now: 100 });
  assert.deepEqual(note, { seq: 5, count: 3, added: 3, sets: ['A'], at: 100, dismissed: false });
});

test('first bundle with no cards, or missing cards, stores nothing', () => {
  assert.equal(nextCardDataNote(undefined, { seq: 5, cards: [], now: 1 }), null);
  assert.equal(nextCardDataNote(null, { seq: 5, now: 1 }), null);
});

test('same seq and count stores nothing', () => {
  const prev = { seq: 5, count: 3, added: 3, sets: ['A'], at: 1, dismissed: false };
  assert.equal(nextCardDataNote(prev, { seq: 5, cards: many(3), now: 2 }), null);
});

test('more cards than before reports only the difference, undismissed', () => {
  const prev = { seq: 5, count: 3, added: 3, sets: ['A'], at: 1, dismissed: true };
  const note = nextCardDataNote(prev, { seq: 6, cards: many(10), now: 9 });
  assert.equal(note.added, 7);
  assert.equal(note.count, 10);
  assert.equal(note.dismissed, false);
  assert.equal(note.at, 9);
});

test('same count with another seq keeps the old record with the new seq, seen or not', () => {
  for (const dismissed of [false, true]) {
    const prev = { seq: 5, count: 3, added: 3, sets: ['A'], at: 1, dismissed };
    assert.deepEqual(nextCardDataNote(prev, { seq: 6, cards: many(3), now: 7 }), { ...prev, seq: 6 }, `dismissed ${dismissed}`);
  }
});

test('a lower count or no cards keeps the stored count, so they are not announced again later', () => {
  const prev = { seq: 5, count: 100, added: 100, sets: ['A'], at: 1, dismissed: true };
  const lower = nextCardDataNote(prev, { seq: 6, cards: many(40), now: 7 });
  assert.deepEqual(lower, { ...prev, seq: 6 });
  const none = nextCardDataNote(lower, { seq: 7, cards: [], now: 8 });
  assert.deepEqual(none, { ...prev, seq: 7 });
  assert.deepEqual(nextCardDataNote(none, { seq: 8, now: 9 }), { ...prev, seq: 8 });
});

test('100 cards dismissed, then a bundle with none, then the same 100 again: no new banner', () => {
  const first = nextCardDataNote(null, { seq: 1, cards: many(100), now: 1 });
  const seen = dismissedNote(first);
  const empty = nextCardDataNote(seen, { seq: 2, cards: [], now: 2 });
  assert.equal(empty.dismissed, true);
  assert.equal(empty.count, 100);
  const again = nextCardDataNote(empty, { seq: 3, cards: many(100), now: 3 });
  assert.equal(again.dismissed, true);
  assert.equal(cardDataNoteText(again), null);
});

test('an undismissed note survives a later bundle with the same count', () => {
  const first = nextCardDataNote(null, { seq: 1, cards: many(5), now: 1 });
  const later = nextCardDataNote(first, { seq: 2, cards: many(5), now: 2 });
  assert.equal(later.dismissed, false);
  assert.equal(later.added, 5);
  assert.equal(later.at, 1);
  assert.ok(cardDataNoteText(later));
});

test('sets: at most three, by card count descending, ties by name', () => {
  const list = [...many(1, 'D'), ...many(5, 'C'), ...many(2, 'B'), ...many(2, 'A'), ...many(1, 'E')];
  const note = nextCardDataNote(null, { seq: 1, cards: list, now: 1 });
  assert.deepEqual(note.sets, ['C', 'A', 'B']);
});

test('sets: entries without a usable set name are skipped', () => {
  const list = [{ id: 1 }, { id: 2, set: '' }, { id: 3, set: 7 }, { id: 4, set: 'Z' }, null];
  const note = nextCardDataNote(null, { seq: 1, cards: list, now: 1 });
  assert.deepEqual(note.sets, ['Z']);
  assert.equal(note.count, 5);
});

test('malformed prev counts as missing', () => {
  for (const prev of ['x', 5, [], { seq: 1, count: 1.5 }, { seq: 1, count: '3' }, { seq: 1 }]) {
    assert.equal(nextCardDataNote(prev, { seq: 1, cards: [], now: 1 }), null, JSON.stringify(prev));
    assert.equal(nextCardDataNote(prev, { seq: 1, cards: many(2), now: 1 }).added, 2, JSON.stringify(prev));
  }
});

test('a seq that is not a finite number is stored as null and never equals a previous one', () => {
  const note = nextCardDataNote(null, { seq: 'x', cards: many(2), now: 1 });
  assert.equal(note.seq, null);
  assert.ok(nextCardDataNote(note, { seq: undefined, cards: many(2), now: 2 }), 'null seq does not match null seq');
  assert.equal(nextCardDataNote(null, { seq: NaN, cards: many(1), now: 1 }).seq, null);
});

test('text: plural, singular and set lists', () => {
  const base = { seq: 1, count: 499, added: 499, at: 1, dismissed: false };
  assert.equal(cardDataNoteText({ ...base, sets: [] }), 'Card data updated: 499 new cards from the newest sets can now be recognized.');
  assert.equal(cardDataNoteText({ ...base, added: 1, sets: [] }), 'Card data updated: 1 new card from the newest sets can now be recognized.');
  assert.match(cardDataNoteText({ ...base, sets: ['A'] }), / Sets include A\.$/);
  assert.match(cardDataNoteText({ ...base, sets: ['A', 'B'] }), / Sets include A and B\.$/);
  assert.match(cardDataNoteText({ ...base, sets: ['A', 'B', 'C'] }), / Sets include A, B and C\.$/);
});

test('text: nothing to show gives null', () => {
  const ok = { seq: 1, count: 2, added: 2, sets: [], at: 1, dismissed: false };
  assert.equal(cardDataNoteText(null), null);
  assert.equal(cardDataNoteText(undefined), null);
  assert.equal(cardDataNoteText({ ...ok, dismissed: true }), null);
  for (const added of [0, -1, 1.5, '3', NaN, undefined]) assert.equal(cardDataNoteText({ ...ok, added }), null, String(added));
});

test('text: set names that are not short plain strings are dropped', () => {
  const note = { seq: 1, count: 2, added: 2, at: 1, dismissed: false, sets: [5, 'x'.repeat(201), 'Ok', null] };
  assert.match(cardDataNoteText(note), / Sets include Ok\.$/);
  assert.doesNotMatch(cardDataNoteText({ ...note, sets: [5, null] }), /Sets include/);
  assert.match(cardDataNoteText({ ...note, sets: ['x'.repeat(200)] }), /Sets include x{200}\.$/);
  assert.doesNotMatch(cardDataNoteText({ ...note, sets: 'A' }), /Sets include/);
});

test('dismissedNote keeps the record and sets dismissed', () => {
  const note = { seq: 1, count: 2, added: 2, sets: ['A'], at: 1, dismissed: false };
  assert.deepEqual(dismissedNote(note), { ...note, dismissed: true });
  assert.equal(note.dismissed, false, 'input not mutated');
  assert.equal(dismissedNote(null), null);
  assert.equal(dismissedNote(undefined), null);
});

test('entries from a real catalogExtra file, as the worker merges them, give the set names', () => {
  const DIM = 512;
  const card = (id, set, setName, number) => ({ id, name: 'N', set, setName, number, image: `https://assets.tcgdex.net/en/${set}/${number}/high.webp` });
  const cards = [card('a-1', 'a', 'Alpha Set', '1'), card('a-2', 'a', 'Alpha Set', '2'), card('b-1', 'b', 'Beta Set', '1'), card('base-1', 'base', 'Old Set', '1')];
  const head = new TextEncoder().encode(JSON.stringify({ v: 1, dim: DIM, entries: cards.length, cardIds: cards.map((c) => c.id), cards }));
  const bytes = new Uint8Array(4 + head.length + cards.length * DIM);
  new DataView(bytes.buffer).setUint32(0, head.length, true);
  bytes.set(head, 4);
  cards.forEach((_, i) => { bytes[4 + head.length + i * DIM + i] = 127; });
  const extra = parseCatalogExtra(bytes);
  const merged = mergeExtra([{ id: 'base-1' }], extra);
  assert.equal(merged.meta.length, 3, 'the card the shipped catalog already has is not new');
  const note = nextCardDataNote(null, { seq: 4, cards: merged.meta, now: 1 });
  assert.deepEqual(note.sets, ['Alpha Set', 'Beta Set']);
  assert.match(cardDataNoteText(note), /^Card data updated: 3 new cards .* Sets include Alpha Set and Beta Set\.$/);
});
