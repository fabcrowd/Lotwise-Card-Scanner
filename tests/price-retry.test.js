import assert from 'node:assert/strict';
import test from 'node:test';
import { asLowCertaintyGuess } from '../tools/extension-wasm/lib/card-picker.js';
import { chooseState } from '../tools/extension-wasm/lib/choose-flow.js';
import { AUTO_PRICE_RETRY_MS, retryAnswerLands, retryKey, wantsAutoRetry } from '../tools/extension-wasm/lib/price-retry.js';

// The shape the scan gives a card it named itself: sure, no set menu to settle, no user flag.
const confirmed = (over = {}) => ({
  identity: { id: 'ex12-1', name: 'Aerodactyl' }, abstain: false, confidence: 0.95, setChoices: [],
  market_price: null, price_variant: null, price_grid: null, priceError: "Couldn't get a price. Try again.",
  ...over,
});

test('the delay is a few seconds', () => {
  assert.ok(AUTO_PRICE_RETRY_MS >= 3000 && AUTO_PRICE_RETRY_MS <= 10000);
});

test('a card the scan confirmed itself, on a failed batch price, wants one retry', () => {
  assert.equal(chooseState(confirmed()), 'confirmed');
  assert.equal(wantsAutoRetry(confirmed()), true);
});

test('no retry for "no price exists" (no error), a lookup in flight, a skipped or back card, or no card', () => {
  assert.equal(wantsAutoRetry(confirmed({ priceError: null })), false);
  assert.equal(wantsAutoRetry(confirmed({ priceError: undefined })), false);
  assert.equal(wantsAutoRetry(confirmed({ pricing: true })), false);
  assert.equal(wantsAutoRetry(confirmed({ skipped: true })), false);
  assert.equal(wantsAutoRetry(confirmed({ cardBack: true })), false);
  assert.equal(wantsAutoRetry(confirmed({ identity: { name: 'No id' } })), false);
  assert.equal(wantsAutoRetry(null), false);
});

test('a low-certainty guess whose batch price failed does not want a retry', () => {
  const read = { abstain: true, confidence: 0.3, catalogTop: 0.8, nearest: ['ex12-1'] };
  const guess = asLowCertaintyGuess(read, (id) => ({ id, name: 'Aerodactyl' }));
  assert.equal(guess.lowCertainty, true);
  const row = { ...guess, priceError: "Couldn't get a price. Try again." };
  assert.equal(chooseState(row), 'choose');
  assert.equal(wantsAutoRetry(row), false);
});

test('a failed user pick (identity held, set not confirmed, Choose) does not want a retry', () => {
  assert.equal(wantsAutoRetry(confirmed({ setConfirmed: false, abstain: true, confidence: 0.3 })), false);
  assert.equal(wantsAutoRetry(confirmed({ identity: null, setConfirmed: false, abstain: true, confidence: 0 })), false);
});

test('the key changes with the scan, the row and the card', () => {
  const key = retryKey(3, 0, 'ex12-1');
  assert.notEqual(key, retryKey(4, 0, 'ex12-1'));
  assert.notEqual(key, retryKey(3, 1, 'ex12-1'));
  assert.notEqual(key, retryKey(3, 0, 'ex12-2'));
  assert.equal(key, retryKey(3, 0, 'ex12-1'));
});

test('a retry answer lands only on the row that still holds the card it was started for', () => {
  const row = confirmed();
  assert.equal(retryAnswerLands(row, 'ex12-1', false), true);
  assert.equal(retryAnswerLands(confirmed({ identity: { id: 'ex12-2', name: 'Other' } }), 'ex12-1', false), false);
  assert.equal(retryAnswerLands(confirmed({ identity: { name: 'Open version' } }), 'ex12-1', false), false);
  assert.equal(retryAnswerLands(null, 'ex12-1', false), false);
});

test('a retry answer is dropped for a removed or skipped row and for a row the user started a lookup on', () => {
  assert.equal(retryAnswerLands(confirmed({ removed: true }), 'ex12-1', false), false);
  assert.equal(retryAnswerLands(confirmed({ skipped: true }), 'ex12-1', false), false);
  assert.equal(retryAnswerLands(confirmed(), 'ex12-1', true), false);
});

test('a removed row never wants a retry', () => {
  assert.equal(wantsAutoRetry(confirmed({ removed: true, skipped: true })), false);
});
