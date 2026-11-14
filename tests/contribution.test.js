import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BOX_KINDS, CROP_LONG_SIDE, MAX_CARDS, MAX_CROP_CHARS, SIGNAL_SOURCES, buildContribution, dayOf, detectorOf, modelTags, normalizeBox, cropSize, cropTooSmall, scannerOf, validateContribution } from '../tools/extension-wasm/lib/contribution.js';
import { EMBEDDING_VERSION } from '../tools/extension-wasm/lib/embed.js';

const INSTALL = '3f2b1c9e-8a47-4d65-9b0e-1c2d3e4f5a6b';
const row = (over = {}) => ({
  box: [0.1, 0.2, 0.3, 0.4],
  crop: 'QUJD',
  answer: { cardId: 'base1-4' },
  scanner: { cardId: 'base1-5', confidence: 0.4, stripe: 'low' },
  source: 'pick',
  ...over,
});
// 0000000000000001 is teach; 0000000000000005 is exam.
const good = (over = {}) => ({
  v: 1, install: INSTALL, split: 'teach', photoId: '0000000000000001', day: '2026-10-16',
  model: { clip: '0dba1302580da2a6', crop: EMBEDDING_VERSION }, catalog: '2f3c50cec84937ff',
  cards: [row()], ...over,
});

test('a well-formed contribution has no errors', () => {
  assert.deepEqual(validateContribution(good()), []);
});

test('model tags are the first 16 hex of the pinned CLIP model and catalog hashes', () => {
  assert.deepEqual(modelTags(), { clip: '0dba1302580da2a6', catalog: '2f3c50cec84937ff', crop: EMBEDDING_VERSION });
});

test('every field is checked', () => {
  const bad = (contribution, pattern) => {
    const errors = validateContribution(contribution);
    assert.ok(errors.some((e) => pattern.test(e)), `${pattern}: ${JSON.stringify(errors)}`);
  };
  bad(good({ v: 2 }), /^v/);
  bad(good({ install: 'nope' }), /install/);
  bad(good({ split: 'maybe' }), /split/);
  bad(good({ photoId: 'ABC' }), /photoId/);
  bad(good({ split: 'exam' }), /split.*photoId/);
  bad(good({ photoId: '0000000000000005' }), /split.*photoId/);
  bad(good({ day: '16-10-2026' }), /day/);
  bad(good({ model: { clip: 'zz', crop: 2 } }), /model\.clip/);
  bad(good({ model: { clip: '0dba1302580da2a6', crop: 0 } }), /model\.crop/);
  bad(good({ catalog: '12' }), /catalog/);
  bad(good({ cards: [] }), /cards/);
  bad(good({ cards: Array.from({ length: MAX_CARDS + 1 }, () => row()) }), /cards/);
  bad(good({ cards: [row({ box: [0, 0, 1] })] }), /box/);
  bad(good({ cards: [row({ box: [-0.1, 0, 0.5, 0.5] })] }), /box/);
  bad(good({ cards: [row({ box: [0.5, 0, 0.6, 0.5] })] }), /box/);
  bad(good({ cards: [row({ box: [0, 0, 0, 0.5] })] }), /box/);
  bad(good({ cards: [row({ crop: '' })] }), /crop/);
  bad(good({ cards: [row({ crop: 'not base64!' })] }), /crop/);
  bad(good({ cards: [row({ crop: 'A'.repeat(MAX_CROP_CHARS + 1) })] }), /crop/);
  bad(good({ cards: [row({ answer: {} })] }), /answer/);
  bad(good({ cards: [row({ answer: { cardId: '' } })] }), /answer/);
  bad(good({ cards: [row({ answer: { cardId: 'a', unknown: true } })] }), /answer/);
  bad(good({ cards: [row({ answer: { notACard: false } })] }), /answer/);
  bad(good({ cards: [row({ scanner: { cardId: 5, confidence: 0.4, stripe: 'low' } })] }), /scanner\.cardId/);
  bad(good({ cards: [row({ scanner: { cardId: null, confidence: 2, stripe: 'low' } })] }), /scanner\.confidence/);
  bad(good({ cards: [row({ scanner: { cardId: null, confidence: 0.5, stripe: 'loud' } })] }), /scanner\.stripe/);
  bad(good({ cards: [row({ source: 'guess' })] }), /source/);
  bad(good({ extra: 1 }), /extra/);
  bad(good({ cards: [row({ pageUrl: 'https://x' })] }), /pageUrl/);
  bad(null, /object/);
});

test('the three answer shapes and a null scanner card are accepted', () => {
  const cards = [
    row({ answer: { notACard: true }, source: 'confirm', scanner: { cardId: null, confidence: 0, stripe: 'none' } }),
    row({ answer: { unknown: true }, source: 'wrong-card' }),
    row({ answer: { cardId: 'x1' }, source: 'confirm' }),
  ];
  assert.deepEqual(validateContribution(good({ cards })), []);
});

const detector = (over = {}) => ({ score: 0.7, aspect: 0.714, kind: 'found', ...over });
const signal = (over = {}) => row({ answer: { unknown: true }, source: 'removed', detector: detector(), ...over });
const errorsOf = (card) => validateContribution(good({ cards: [card] }));

test('the box signal sources and kinds are listed', () => {
  assert.deepEqual(SIGNAL_SOURCES, ['drawn', 'removed', 'put-back']);
  assert.deepEqual(BOX_KINDS, ['found', 'missed', 'hidden', 'tooSmall']);
});

test('a valid row for each box signal source', () => {
  for (const source of SIGNAL_SOURCES) assert.deepEqual(errorsOf(signal({ source })), [], source);
  assert.deepEqual(errorsOf(signal({ source: 'drawn', answer: { cardId: 'base1-4' }, detector: detector({ score: null, kind: 'missed' }) })), []);
  for (const kind of BOX_KINDS) assert.deepEqual(errorsOf(signal({ detector: detector({ kind }) })), [], kind);
  assert.deepEqual(errorsOf(signal({ detector: detector({ aspect: 0.05 }) })), []);
  assert.deepEqual(errorsOf(signal({ detector: detector({ aspect: 20 }) })), []);
});

test('the detector key is required on box signal rows and not allowed on the others', () => {
  const noDetector = Object.fromEntries(Object.entries(signal()).filter(([key]) => key !== 'detector'));
  for (const source of SIGNAL_SOURCES) assert.ok(errorsOf({ ...noDetector, source }).some((e) => /detector/.test(e)), source);
  for (const source of ['pick', 'wrong-card', 'confirm']) assert.ok(errorsOf(row({ source, detector: detector() })).some((e) => /detector/.test(e)), source);
  assert.deepEqual(errorsOf(row()), []);
});

test('each detector field is checked', () => {
  const bad = (d) => assert.ok(errorsOf(signal({ detector: d })).some((e) => /detector/.test(e)), JSON.stringify(d));
  bad(null);
  bad([]);
  bad('found');
  bad(detector({ score: 1.5 }));
  bad(detector({ score: -0.1 }));
  bad(detector({ score: '0.5' }));
  bad(detector({ score: NaN }));
  bad(detector({ aspect: 0.049 }));
  bad(detector({ aspect: 20.1 }));
  bad(detector({ aspect: NaN }));
  bad(detector({ aspect: '1' }));
  bad(detector({ kind: 'lost' }));
  bad(detector({ kind: undefined }));
  bad({ score: 0.5, aspect: 1 });
  bad({ ...detector(), extra: 1 });
});

test('box signal answers: unknown, or a card id only on a drawn box; never notACard', () => {
  assert.ok(errorsOf(signal({ answer: { notACard: true } })).some((e) => /answer/.test(e)));
  assert.ok(errorsOf(signal({ source: 'drawn', answer: { notACard: true } })).some((e) => /answer/.test(e)));
  for (const source of ['removed', 'put-back']) assert.ok(errorsOf(signal({ source, answer: { cardId: 'x1' } })).some((e) => /answer/.test(e)), source);
});

test('detectorOf builds the detector from a photo-pixel box', () => {
  assert.deepEqual(detectorOf({ score: 0.7, box: [0, 0, 100, 140], kind: 'found' }), { score: 0.7, aspect: 0.714, kind: 'found' });
  assert.deepEqual(detectorOf({ score: 2, box: [10, 10, 110, 60], kind: 'missed' }), { score: 1, aspect: 2, kind: 'missed' });
  assert.equal(detectorOf({ score: -3, box: [0, 0, 10, 10], kind: 'hidden' }).score, 0);
  assert.equal(detectorOf({ score: undefined, box: [0, 0, 10, 10], kind: 'tooSmall' }).score, null);
  assert.equal(detectorOf({ score: NaN, box: [0, 0, 10, 10], kind: 'found' }).score, null);
  assert.equal(detectorOf({ score: null, box: [0, 0, 10, 10], kind: 'found' }).score, null);
});

test('detectorOf is null for an empty box, an extreme aspect or an unknown kind', () => {
  assert.equal(detectorOf({ score: 0.5, box: [5, 5, 5, 50], kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [5, 5, 50, 5], kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [50, 50, 5, 5], kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [0, 0, 1, 21], kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [0, 0, 21, 1], kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [0, 0, 10, 10], kind: 'lost' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [0, 0, 10], kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: null, kind: 'found' }), null);
  assert.equal(detectorOf({ score: 0.5, box: [0, 0, NaN, 10], kind: 'found' }), null);
});

test('an exam contribution is split exam with an exam photo', () => {
  assert.deepEqual(validateContribution(good({ split: 'exam', photoId: '0000000000000005' })), []);
});

test('buildContribution fills the model tags, split and day, and validates', () => {
  const built = buildContribution({ install: INSTALL, photoId: '0000000000000005', cards: [row()], now: new Date('2026-10-16T23:59:00Z') });
  assert.equal(built.split, 'exam');
  assert.equal(built.day, '2026-10-16');
  assert.equal(built.model.clip, '0dba1302580da2a6');
  assert.equal(built.catalog, '2f3c50cec84937ff');
  assert.equal(built.v, 1);
  assert.throws(() => buildContribution({ install: 'x', photoId: '0000000000000005', cards: [row()] }), /install/);
});

test('dayOf is the UTC date', () => {
  assert.equal(dayOf(new Date('2026-01-02T23:30:00-05:00')), '2026-01-03');
});

test('normalizeBox turns a pixel box into fractions of the photo', () => {
  assert.deepEqual(normalizeBox([100, 50, 300, 250], 1000, 500), [0.1, 0.1, 0.2, 0.4]);
  assert.deepEqual(normalizeBox([-10, -10, 2000, 900], 1000, 500), [0, 0, 1, 1]);
  assert.equal(normalizeBox([5, 5, 5, 9], 100, 100), null);
});

test('scannerOf reads what the scanner said about a card', () => {
  assert.deepEqual(scannerOf({ identity: { id: 'a' }, confidence: 0.9 }), { cardId: 'a', confidence: 0.9, stripe: 'high' });
  assert.deepEqual(scannerOf({ identity: { id: 'a' }, confidence: 0.6 }), { cardId: 'a', confidence: 0.6, stripe: 'medium' });
  assert.deepEqual(scannerOf({ identity: { id: 'a' }, confidence: 0.2 }), { cardId: 'a', confidence: 0.2, stripe: 'low' });
  assert.deepEqual(scannerOf({ identity: null, abstain: true, confidence: 0 }), { cardId: null, confidence: 0, stripe: 'none' });
  assert.deepEqual(scannerOf({ identity: { id: 'a' }, confidence: 7 }), { cardId: 'a', confidence: 1, stripe: 'high' });
  assert.deepEqual(scannerOf(null), { cardId: null, confidence: 0, stripe: 'none' });
});

test('cropSize scales the long side to 320 and keeps the shape', () => {
  assert.equal(CROP_LONG_SIDE, 320);
  assert.deepEqual(cropSize(375, 525), { width: 229, height: 320 });
  assert.deepEqual(cropSize(800, 400), { width: 320, height: 160 });
  assert.deepEqual(cropSize(100, 100), { width: 320, height: 320 });
});

test('cropTooSmall is true only when the long side is under the sent size', () => {
  assert.equal(cropTooSmall(160, 224), true);
  assert.equal(cropTooSmall(319, 100), true);
  assert.equal(cropTooSmall(375, 525), false);
  assert.equal(cropTooSmall(320, 100), false);
  assert.equal(cropTooSmall(100, 320), false);
});
