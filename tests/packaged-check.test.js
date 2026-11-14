import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cardProbability, checkKeepsBox, parseCheck, parsePackagedCheck, pickCheck } from '../tools/extension-wasm/lib/bundle.js';
import { modelTags } from '../tools/extension-wasm/lib/contribution.js';

const asset = (name) => readFileSync(new URL(`../tools/extension-wasm/assets/${name}`, import.meta.url));
const fixture = (name) => readFileSync(new URL(`./fixtures/check/${name}`, import.meta.url));
const parity = JSON.parse(fixture('parity.json').toString('utf8'));
const parityV1 = JSON.parse(fixture('parity-v1.json').toString('utf8'));
const meta = JSON.parse(asset('check.json').toString('utf8'));
const build = () => ({ model: modelTags().clip, crop: modelTags().crop });
const packaged = () => parsePackagedCheck(new Uint8Array(asset('check.bin')), meta);

const DIM = 512;
const N_IN = DIM + 2;

// A v2 blob: uint32 LE header length, JSON header, float32 LE body (W1 hidden x 514, b1, w2).
// `floats` replaces the default body; `header` overrides header fields.
function v2Blob({ header = {}, hidden = 2, floats } = {}) {
  const body = floats ?? Float32Array.from({ length: hidden * N_IN + 2 * hidden }, (_, i) => ((i % 7) - 3) / 100);
  const head = new TextEncoder().encode(JSON.stringify({
    v: 2, dim: DIM, hidden, extras: ['det_conf', 'aspect'], extra_mean: [0.5, 0.7], extra_std: [0.2, 0.1], bias2: -0.5, threshold: 0.3, ...header,
  }));
  const out = new Uint8Array(4 + head.length + body.byteLength);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), 4 + head.length);
  return out;
}

const sampleEmbedding = () => Float32Array.from({ length: DIM }, (_, i) => Math.sin(i) / 20);

test('v1 check still parses to { weights, bias, threshold } and matches the v1 Python probabilities within 1e-5', () => {
  const check = parseCheck(new Uint8Array(fixture('check-v1.bin')));
  assert.deepEqual(Object.keys(check).sort(), ['bias', 'threshold', 'weights']);
  assert.equal(check.weights.length, DIM);
  assert.ok(parityV1.cases.length >= 5);
  for (const { embedding, p } of parityV1.cases) {
    assert.ok(Math.abs(cardProbability(Float32Array.from(embedding), check) - p) < 1e-5, `p=${p}`);
  }
  assert.ok(Math.abs(check.threshold - parityV1.threshold) < 1e-12);
});

test('v2: JS cardProbability on stored embeddings equals the Python probabilities within 1e-5', () => {
  const check = parseCheck(new Uint8Array(asset('check.bin')));
  assert.equal(check.v, 2);
  assert.ok(parity.cases.length >= 5);
  for (const { embedding, det_conf, aspect, p } of parity.cases) {
    assert.ok(Math.abs(cardProbability(Float32Array.from(embedding), check, { detConf: det_conf, aspect }) - p) < 1e-5, `p=${p}`);
  }
  assert.ok(Math.abs(check.threshold - parity.threshold) < 1e-12);
});

test('the shipped check is v2 with 128 hidden units', () => {
  const check = packaged();
  assert.equal(check.v, 2);
  assert.equal(check.hidden, 128);
  assert.equal(check.w1.length, 128 * N_IN);
  assert.equal(check.b1.length, 128);
  assert.equal(check.w2.length, 128);
});

test('the shipped check is made for exactly this build: same model and crop as modelTags()', () => {
  const check = packaged();
  assert.deepEqual({ model: check.model, crop: check.crop }, build());
});

test('parseCheck v2 returns Float32Arrays and the header values; synthetic scoring matches a plain float64 loop', () => {
  const check = parseCheck(v2Blob());
  assert.deepEqual(Object.keys(check).sort(), ['b1', 'bias2', 'extraMean', 'extraStd', 'hidden', 'threshold', 'v', 'w1', 'w2']);
  assert.equal(check.v, 2);
  assert.equal(check.hidden, 2);
  assert.ok(check.w1 instanceof Float32Array && check.b1 instanceof Float32Array && check.w2 instanceof Float32Array);
  assert.equal(check.threshold, 0.3);
  const e = sampleEmbedding();
  const x = [...e, (0.9 - 0.5) / 0.2, (0.72 - 0.7) / 0.1];
  const floats = Float32Array.from({ length: 2 * N_IN + 4 }, (_, i) => ((i % 7) - 3) / 100);
  let logit = -0.5;
  for (let h = 0; h < 2; h++) {
    let z = floats[2 * N_IN + h];
    for (let d = 0; d < N_IN; d++) z += floats[h * N_IN + d] * x[d];
    logit += Math.max(z, 0) * floats[2 * N_IN + 2 + h];
  }
  const want = 1 / (1 + Math.exp(-logit));
  assert.ok(Math.abs(cardProbability(e, check, { detConf: 0.9, aspect: 0.72 }) - want) < 1e-9);
});

test('parseCheck refuses v2 files that are malformed', () => {
  const good = 2 * N_IN + 4;
  const ones = (n) => new Float32Array(n).fill(0.01);
  assert.doesNotThrow(() => parseCheck(v2Blob()));
  assert.throws(() => parseCheck(v2Blob({ floats: ones(good - 1) })), /size/);
  assert.throws(() => parseCheck(v2Blob({ floats: ones(good + 1) })), /size/);
  for (const hidden of [0, 1.5, 1025, '2', null]) {
    assert.throws(() => parseCheck(v2Blob({ header: { hidden } })), /hidden/, `hidden=${hidden}`);
  }
  for (const extras of [['aspect', 'det_conf'], ['det_conf'], ['det_conf', 'aspect', 'x'], 'det_conf', undefined]) {
    assert.throws(() => parseCheck(v2Blob({ header: { extras } })), /extras/);
  }
  for (const extra_mean of [[0.5], [0.5, 0.7, 0.1], [0.5, '0.7'], [0.5, null], 0.5, undefined]) {
    assert.throws(() => parseCheck(v2Blob({ header: { extra_mean } })), /extra_mean/);
  }
  for (const extra_std of [[0.2], [0.2, 0.1, 0.1], [0.2, 'x'], 0.2, undefined, [0, 0.1], [0.2, 0], [-1, 0.1], [0.2, -0.1]]) {
    assert.throws(() => parseCheck(v2Blob({ header: { extra_std } })), /extra_std/);
  }
  for (const bias2 of ['1', null, undefined]) {
    assert.throws(() => parseCheck(v2Blob({ header: { bias2 } })), /bias2/);
  }
  for (const threshold of [0, 1, -0.1, 1.5, null, '0.3', undefined]) {
    assert.throws(() => parseCheck(v2Blob({ header: { threshold } })), /threshold/);
  }
  for (const bad of [NaN, Infinity, -Infinity]) {
    const floats = ones(good);
    floats[5] = bad;
    assert.throws(() => parseCheck(v2Blob({ floats })), /finite/);
  }
  assert.throws(() => parseCheck(v2Blob({ header: { dim: 256 } })), /build/);
  assert.throws(() => parseCheck(v2Blob({ header: { v: 3 } })), /build/);
});

test('cardProbability returns null when a v2 check lacks a usable det_conf or aspect', () => {
  const check = parseCheck(v2Blob());
  const e = sampleEmbedding();
  assert.equal(typeof cardProbability(e, check, { detConf: 0.5, aspect: 0.7 }), 'number');
  assert.equal(cardProbability(e, check), null);
  assert.equal(cardProbability(e, check, {}), null);
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, '0.5', {}, true]) {
    assert.equal(cardProbability(e, check, { detConf: bad, aspect: 0.7 }), null, `detConf=${String(bad)}`);
    assert.equal(cardProbability(e, check, { detConf: 0.5, aspect: bad }), null, `aspect=${String(bad)}`);
  }
});

test('cardProbability returns null for either version when the result is not finite', () => {
  const v2 = parseCheck(v2Blob());
  const v1 = { weights: new Float32Array(DIM), bias: 0, threshold: 0.5 };
  const nan = sampleEmbedding();
  nan[3] = NaN;
  assert.equal(cardProbability(nan, v2, { detConf: 0.5, aspect: 0.7 }), null);
  assert.equal(cardProbability(nan, v1), null);
});

test('checkKeepsBox keeps a box when the check cannot run, or p >= threshold; hides it when p < threshold', () => {
  const zeros = (n) => new Float32Array(n);
  // v2 with every weight 0 except b1 = 2: p = sigmoid(max(2, 0) * 1 + 0) = 0.8808
  const v2 = (threshold) => ({ v: 2, hidden: 1, w1: zeros(N_IN), b1: Float32Array.of(2), w2: Float32Array.of(1), bias2: 0, extraMean: [0, 0], extraStd: [1, 1], threshold });
  const v1 = (threshold) => ({ weights: zeros(DIM), bias: 1, threshold }); // p = sigmoid(1) = 0.7311
  const e = zeros(DIM);
  const extras = { detConf: 0.5, aspect: 0.7 };
  const high = checkKeepsBox(e, v2(0.5), extras);
  assert.equal(high.keep, true);
  assert.ok(Math.abs(high.p - 1 / (1 + Math.exp(-2))) < 1e-9);
  assert.deepEqual(checkKeepsBox(e, v2(0.95), extras).keep, false);
  assert.equal(checkKeepsBox(e, v2(0.8807970779778823), extras).keep, true, 'p equal to the threshold keeps');
  assert.deepEqual(checkKeepsBox(e, v2(0.5), undefined), { keep: true, p: null });
  assert.deepEqual(checkKeepsBox(e, v2(0.5), { detConf: NaN, aspect: 0.7 }), { keep: true, p: null });
  const nan = zeros(DIM);
  nan[0] = NaN;
  assert.deepEqual(checkKeepsBox(nan, v2(0.5), extras), { keep: true, p: null });
  assert.equal(checkKeepsBox(e, v1(0.5)).keep, true);
  assert.equal(checkKeepsBox(e, v1(0.9)).keep, false);
  assert.ok(Math.abs(checkKeepsBox(e, v1(0.9)).p - 1 / (1 + Math.exp(-1))) < 1e-9);
  assert.deepEqual(checkKeepsBox(nan, v1(0.5)), { keep: true, p: null });
});

test('checkKeepsBox on the real v2 check agrees with p >= threshold for every parity case', () => {
  const check = parseCheck(new Uint8Array(asset('check.bin')));
  for (const { embedding, det_conf, aspect } of parity.cases) {
    const { keep, p } = checkKeepsBox(Float32Array.from(embedding), check, { detConf: det_conf, aspect });
    assert.equal(keep, p >= check.threshold);
  }
});

test('a valid same-build bundle check wins over the packaged one', () => {
  const stored = { check: { weights: new Float32Array(512), bias: 0, threshold: 0.5 } };
  assert.equal(pickCheck(stored, packaged(), build()), stored.check);
  const storedV2 = { check: parseCheck(v2Blob()) };
  assert.equal(pickCheck(storedV2, packaged(), build()), storedV2.check);
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
