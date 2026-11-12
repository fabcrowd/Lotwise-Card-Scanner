import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cardProbability, parseCheck, parsePackagedCheck, pickCheck } from '../tools/extension-wasm/lib/bundle.js';
import { modelTags } from '../tools/extension-wasm/lib/contribution.js';

const asset = (name) => readFileSync(new URL(`../tools/extension-wasm/assets/${name}`, import.meta.url));
const parity = JSON.parse(readFileSync(new URL('./fixtures/check/parity.json', import.meta.url), 'utf8'));
const meta = JSON.parse(asset('check.json').toString('utf8'));
const build = () => ({ model: modelTags().clip, crop: modelTags().crop });
const packaged = () => parsePackagedCheck(new Uint8Array(asset('check.bin')), meta);

test('JS cardProbability on stored embeddings equals the Python probabilities within 1e-5', () => {
  const check = parseCheck(new Uint8Array(asset('check.bin')));
  assert.ok(parity.cases.length >= 5);
  for (const { embedding, p } of parity.cases) {
    assert.ok(Math.abs(cardProbability(Float32Array.from(embedding), check) - p) < 1e-5, `p=${p}`);
  }
  assert.ok(Math.abs(check.threshold - parity.threshold) < 1e-12);
});

test('the shipped check is made for exactly this build: same model and crop as modelTags()', () => {
  const check = packaged();
  assert.deepEqual({ model: check.model, crop: check.crop }, build());
});

test('a valid same-build bundle check wins over the packaged one', () => {
  const stored = { check: { weights: new Float32Array(512), bias: 0, threshold: 0.5 } };
  assert.equal(pickCheck(stored, packaged(), build()), stored.check);
});

test('a bundle without a check leaves the packaged check in place; so does no bundle at all', () => {
  const check = packaged();
  assert.equal(pickCheck({ manifest: {}, check: null }, check, build()), check);
  assert.equal(pickCheck(null, check, build()), check);
});

test('a packaged check for another model or crop is ignored', () => {
  const check = packaged();
  assert.equal(pickCheck(null, { ...check, model: '0000000000000000' }, build()), null);
  assert.equal(pickCheck(null, { ...check, crop: check.crop + 1 }, build()), null);
  assert.equal(pickCheck(null, null, build()), null);
});

test('parsePackagedCheck refuses a check.bin that does not parse or a meta with no model', () => {
  assert.throws(() => parsePackagedCheck(new Uint8Array(8), meta));
  assert.throws(() => parsePackagedCheck(new Uint8Array(asset('check.bin')), { crop_version: 3 }));
});
