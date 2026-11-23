import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allPriced, doubleCheckText, pickPrintingHeading, pricedHeading } from '../tools/extension-wasm/lib/choose-flow.js';

const cand = (id, name) => ({ id, name, set: 'Base Set', setCode: 'base1', number: '58' });
const grid = { source: 'pokemontcg', variants: { normal: { market: 5, conditions: { NM: 5 } } } };
const sure = (extra = {}) => ({ identity: cand('base1-58', 'Pikachu'), confidence: 0.9, abstain: false, setConfirmed: true, price_grid: grid, ...extra });
const choose = () => ({ identity: null, confidence: 0.3, abstain: true, candidates: [cand('a-1', 'Pidgey'), cand('b-2', 'Rattata')] });
const openPrinting = () => sure({ setConfirmed: false, setChoices: [cand('s-1', 'Pikachu'), cand('s-2', 'Pikachu')] });

test('group headings read plainly', () => {
  assert.equal(pricedHeading(4), 'Priced (4)');
  assert.equal(pickPrintingHeading(2), 'Pick a version (2)');
});

test('allPriced: true only when something is priced and nothing is left to confirm or to pick a printing for', () => {
  assert.equal(allPriced([sure(), sure()]), true);
  assert.equal(allPriced([sure(), choose()]), false);
  assert.equal(allPriced([sure(), openPrinting()]), false);
  assert.equal(allPriced([]), false);
  assert.equal(allPriced([choose()]), false);
  assert.equal(allPriced([sure({ pricing: true })]), false);
  // Skipped and card-back cards are left out of the lot, so they do not block it.
  assert.equal(allPriced([sure(), { skipped: true }, { cardBack: true }]), true);
  assert.equal(allPriced([{ skipped: true }]), false);
});

test('allPriced: hidden or unrecognised entries do not block it; a card with no price or a price error does', () => {
  // Hidden not-card entries and unrecognised card backs are not rows of the list.
  assert.equal(allPriced([sure(), { notCard: true, identity: null }, { cardBack: true }]), true);
  assert.equal(allPriced([sure(), { notCard: true, identity: null, crop: 'x' }]), true);
  assert.equal(allPriced([{ notCard: true, identity: null }]), false);
  // A confirmed card whose price failed, or that has none, is not priced.
  assert.equal(allPriced([sure(), sure({ priceError: 'Could not get a price', price_grid: null, market_price: null })]), false);
  assert.equal(allPriced([sure(), sure({ price_grid: null, market_price: null })]), false);
  assert.equal(allPriced([sure({ price_grid: null, market_price: 3 })]), true);
});

test('allPriced: a card still flagged "high value, double-check" blocks it until the flag is cleared', () => {
  const flagged = (card) => card.hv === true;
  assert.equal(allPriced([sure({ hv: true }), sure()], flagged), false);
  assert.equal(allPriced([sure({ hv: false }), sure()], flagged), true);
  assert.equal(allPriced([sure({ hv: true }), sure()]), true, 'no flag test given: as before');
  // A flag on a card the list does not show (skipped) is no row, so it does not block.
  assert.equal(allPriced([sure(), { skipped: true, hv: true }], flagged), true);
});

test('the lot card counts the flags that are left', () => {
  assert.equal(doubleCheckText(1), '1 to double-check');
  assert.equal(doubleCheckText(3), '3 to double-check');
});
