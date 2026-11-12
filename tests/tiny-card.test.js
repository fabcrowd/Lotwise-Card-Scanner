import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTooSmallBox, tooSmallCard, smallPhotoCounts, canFrameTooSmall, keepTooSmall, TOO_SMALL_LABEL, TOO_SMALL_ROW_TEXT } from '../tools/extension-wasm/lib/tiny-card.js';
import { classifyCard, lotEstimate, scanStatus } from '../tools/extension-wasm/lib/card-display.js';
import { lotExportRows } from '../tools/extension-wasm/lib/lot-export.js';
import { chooseState } from '../tools/extension-wasm/lib/choose-flow.js';
import { loadPage } from './helpers/fake-page.js';

test('isTooSmallBox keeps the 40 x 60 limits', () => {
  assert.equal(isTooSmallBox([0, 0, 39, 100]), true);
  assert.equal(isTooSmallBox([0, 0, 40, 60]), false);
  assert.equal(isTooSmallBox([0, 0, 100, 59]), true);
  assert.equal(isTooSmallBox([10, 10, 60, 75]), false);
});

test('tooSmallCard is an unread card: no identity, candidates or price, never confirmable', () => {
  const card = tooSmallCard({ box: [1, 2, 3, 4], score: 0.6, readHeight: 52 });
  assert.equal(card.tooSmall, true);
  assert.equal(card.identity, null);
  assert.equal(card.market_price, null);
  assert.equal(card.price_grid, null);
  assert.equal(card.readHeight, 52);
  assert.deepEqual(card.box, [1, 2, 3, 4]);
  assert.equal(classifyCard(card), 'unrecognised');
  assert.equal(chooseState(card), 'back');
  assert.equal(scanStatus([card]), 'Found 1 card: 1 not recognised');
  assert.equal(lotEstimate([card], () => null).total, 0);
  const exported = lotExportRows([card], () => null);
  assert.equal(exported.count, 0);
  assert.equal(exported.notIncluded, 0);
});

test('too-small cards count toward the small-photo chip and the full-size offer', () => {
  const read = (h) => ({ identity: { name: 'X' }, readHeight: h });
  const cards = [read(300), read(250), tooSmallCard({ box: [0, 0, 1, 1], readHeight: 50 }), tooSmallCard({ box: [0, 0, 1, 1], readHeight: 44 }), { cardBack: true, readHeight: 0 }];
  const counts = smallPhotoCounts(cards, 200);
  assert.equal(counts.read, 4);
  assert.equal(counts.small, 2);
});

test('a too-small entry never replaces an earlier card', () => {
  const box = [1, 2, 3, 4];
  assert.equal(keepTooSmall({ claimed: { docBox: box }, mappedBox: box, gallery: false }), true);
  assert.equal(keepTooSmall({ claimed: { docBox: box, replaces: 0 }, mappedBox: box, gallery: false }), false);
  assert.equal(keepTooSmall({ claimed: null, mappedBox: box, gallery: false }), false);
});

test('a too-small gallery box that cannot be mapped into the photo is skipped, not framed around the thumbnail', () => {
  const box = [1, 2, 3, 4];
  assert.equal(canFrameTooSmall({ mappedBox: null, gallery: true }), false);
  assert.equal(canFrameTooSmall({ mappedBox: null, gallery: false }), false);
  assert.equal(canFrameTooSmall({ mappedBox: box, gallery: true }), true);
  assert.equal(keepTooSmall({ claimed: { docBox: box }, mappedBox: null, gallery: true }), false);
});

test('the label for a too-small card is short', () => {
  assert.equal(TOO_SMALL_LABEL, 'Too small');
  assert.equal(TOO_SMALL_ROW_TEXT, 'Too small to read. Open the full-size photo.');
});

test('overlay tag for a too-small card says Too small, not Turn it over', () => {
  const page = loadPage();
  const pure = page.window.__cardScanner.pure;
  const card = tooSmallCard({ box: [1, 2, 30, 50], readHeight: 50 });
  assert.equal(pure.cardState(card), 'none');
  assert.deepEqual([...pure.tagText(card, 0).lines], ['Too small']);
  assert.equal(pure.labelText(card).name, 'Too small');
});
