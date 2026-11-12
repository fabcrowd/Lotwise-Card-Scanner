import { test } from 'node:test';
import assert from 'node:assert/strict';

import { acceptFromBackground, acceptPageSender, acceptRemove, removalStored, removeFromLot } from '../tools/extension-wasm/lib/overlay-remove.js';
import { putBackCard, removeCard, skipCard } from '../tools/extension-wasm/lib/skip.js';
import { chooseState, renderRemoveButton, renderSkippedRow } from '../tools/extension-wasm/lib/choose-flow.js';
import { lotEstimate } from '../tools/extension-wasm/lib/card-display.js';
import { lotExportRows } from '../tools/extension-wasm/lib/lot-export.js';
import { unconfirmedTotal } from '../tools/extension-wasm/lib/stakes.js';

const NOW = Date.UTC(2026, 9, 24);
const none = () => null;
const sure = (over = {}) => ({
  identity: { id: 'base1-58', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false,
  price_grid: { source: 'pokemontcg', variants: { normal: { market: 5, conditions: { NM: 5 } } } }, ...over,
});
const choose = (over = {}) => ({ identity: null, abstain: true, confidence: 0.3, candidates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], ...over });

const URL_A = 'https://shop.test/lot/1';

const TAB_URL = `${URL_A}#photos`;
const EXT = 'ext-id';

test('acceptRemove takes a click for the lot page on a live card, and nothing else', () => {
  const cards = [sure(), choose(), removeCard(sure()), { notCard: true, box: [0, 0, 1, 1] }, { cardBack: true }, { tooSmall: true }];
  assert.equal(acceptRemove(TAB_URL, 0, URL_A, cards), true);
  assert.equal(acceptRemove(TAB_URL, 1, URL_A, cards), true);
  assert.equal(acceptRemove(TAB_URL, 4, URL_A, cards), true, 'a card back stays removable');
  assert.equal(acceptRemove(TAB_URL, 5, URL_A, cards), true, 'a too small row stays removable');
  assert.equal(acceptRemove('https://other.test/', 0, URL_A, cards), false, 'wrong page');
  assert.equal(acceptRemove(undefined, 0, URL_A, cards), false, 'no tab url');
  for (const bad of ['0', 1.5, NaN, null, undefined]) assert.equal(acceptRemove(TAB_URL, bad, URL_A, cards), false, String(bad));
  assert.equal(acceptRemove(TAB_URL, 6, URL_A, cards), false, 'out of range');
  assert.equal(acceptRemove(TAB_URL, -1, URL_A, cards), false, 'negative');
  assert.equal(acceptRemove(TAB_URL, 2, URL_A, cards), false, 'already removed');
  assert.equal(acceptRemove(TAB_URL, 3, URL_A, cards), false, 'a hidden not-a-card box');
  assert.equal(acceptRemove(TAB_URL, 0, null, cards), false, 'no lot url');
  assert.equal(acceptRemove(TAB_URL, 0, URL_A, null), false, 'no cards');
});

test('senders: the page click comes from the extension top frame in a tab; the forward comes from no tab', () => {
  assert.equal(acceptPageSender({ id: EXT, tab: { id: 1 }, frameId: 0 }, EXT), true);
  assert.equal(acceptPageSender({ id: EXT, tab: { id: 1 }, frameId: 2 }, EXT), false, 'sub-frame');
  assert.equal(acceptPageSender({ id: EXT, frameId: 0 }, EXT), false, 'no tab');
  assert.equal(acceptPageSender({ id: 'other', tab: { id: 1 }, frameId: 0 }, EXT), false, 'another extension');
  assert.equal(acceptPageSender(null, EXT), false);
  assert.equal(acceptFromBackground({ id: EXT }, EXT), true);
  assert.equal(acceptFromBackground({ id: EXT, tab: { id: 1 } }, EXT), false, 'a page cannot forge the forward');
  assert.equal(acceptFromBackground({ id: 'other' }, EXT), false);
  assert.equal(acceptFromBackground(undefined, EXT), false);
});

test('removalStored: the page drops the box only when the removal is stored', () => {
  assert.equal(removalStored({ popupHandled: true }), true);
  assert.equal(removalStored({ popupHandled: true, running: true }), true);
  assert.equal(removalStored({ savedChanged: true }), true);
  assert.equal(removalStored({ heldChanged: true }), true);
  assert.equal(removalStored({ savedChanged: true, running: true }), false, 'a running scan would replace the list');
  assert.equal(removalStored({ popupDeclined: true }), false, 'the open window declined');
  assert.equal(removalStored({ popupDeclined: true, savedChanged: true, heldChanged: true }), false, 'nothing stored behind its back');
  assert.equal(removalStored({ popupHandled: true, popupDeclined: true }), true);
  assert.equal(removalStored({}), false, 'nothing changed');
  assert.equal(removalStored(), false);
});

test('removeFromLot removes one card of a saved lot state and leaves the rest of the state alone', () => {
  const state = { cards: [sure(), choose()], bgScanId: 'b1', showSkipped: true };
  const next = removeFromLot(state, 1);
  assert.equal(next.cards[1].removed, true);
  assert.equal(next.cards[1].skipped, true);
  assert.equal(next.cards[0], state.cards[0]);
  assert.equal(next.bgScanId, 'b1');
  assert.equal(next.showSkipped, true);
  assert.equal(state.cards[1].removed, undefined, 'the saved state is not mutated');
  assert.equal(removeFromLot(state, 2), null);
  assert.equal(removeFromLot(state, -1), null);
  assert.equal(removeFromLot(state, 0.5), null);
  assert.equal(removeFromLot(null, 0), null);
  assert.equal(removeFromLot({ cards: [{ notCard: true }] }, 0), null, 'a hidden not-a-card box');
  assert.notEqual(removeFromLot({ cards: [{ cardBack: true }, { tooSmall: true }] }, 1), null);
  assert.equal(removeFromLot({ cards: 'x' }, 0), null);
  assert.equal(removeFromLot(next, 1), null, 'already removed');
});

test('a removed confirmed priced card leaves the total, the export and the unconfirmed figure; put back restores it unchanged', () => {
  const card = sure();
  const removed = removeCard(card);
  assert.equal(chooseState(removed), 'skipped');
  const before = lotEstimate([card], none, ['NM']);
  const after = lotEstimate([removed], none, ['NM']);
  assert.equal(before.low, 5);
  assert.equal(after.low, 0);
  assert.equal(after.high, 0);
  assert.equal(after.identified, 0);
  assert.equal(lotExportRows([card], none, ['NM'], NOW).count, 1);
  const rows = lotExportRows([removed], none, ['NM'], NOW);
  assert.equal(rows.count, 0);
  assert.equal(rows.skipped, 0);
  assert.equal(rows.removed, 1);
  const guess = choose();
  const match = () => ({ price: 3 });
  assert.equal(unconfirmedTotal([guess], match).count, 1);
  assert.equal(unconfirmedTotal([removeCard(guess)], match).count, 0);

  const back = putBackCard(removed);
  assert.equal(chooseState(back), 'confirmed');
  assert.deepEqual(back, card);
  assert.equal(lotEstimate([back], none, ['NM']).low, 5);
});

test('removing a card that was already skipped puts it back to skipped, not to the lot', () => {
  const skipped = skipCard(choose());
  const removed = removeCard(skipped);
  assert.equal(removed.removedFromSkipped, true);
  const back = putBackCard(removed);
  assert.equal(back.skipped, true);
  assert.equal(back.removed, undefined);
  assert.equal(back.removedFromSkipped, undefined);
  assert.equal(chooseState(back), 'skipped');
});

test('renderRemoveButton names the card, carries the index, and escapes nothing it should not', () => {
  const html = renderRemoveButton(2);
  assert.match(html, /^<button type="button" class="remove-btn" data-remove-card data-idx="2"/);
  assert.match(html, /aria-label="Remove card 3 from the lot"/);
  assert.match(html, /title="Remove from the scan\. It is left out of the total\."/);
  assert.match(html, />×<\/button>$/);
  assert.match(renderRemoveButton('"><img>'), /data-idx="&quot;&gt;&lt;img&gt;"/);
  assert.doesNotMatch(renderRemoveButton('"><img>'), /<img>/);
});

test('the Put back label says where the card goes: the lot, or back to the skipped cards', () => {
  assert.match(renderSkippedRow(0, null, true), /Put back card 1: return it to the lot/);
  assert.match(renderSkippedRow(0, null, true, true), /Put back card 1: return it to the skipped cards/);
});
