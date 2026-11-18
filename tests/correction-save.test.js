import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agreeWithReference, evictCorrections, storeCorrection } from '../tools/extension-wasm/lib/correction-save.js';
import { correctionsToEmbed } from '../tools/extension-wasm/lib/references.js';
import { createCorrectionsStore } from '../tools/extension-wasm/lib/corrections-store.js';
import { fakeIndexedDB } from './helpers/fake-idb.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 23);
const draft = (extra = {}) => ({ id: 's:0', ts: NOW, scanId: 's', index: 0, pickedId: 'a', via: 'wrong-card', crop: 'data:image/jpeg;base64,AA', count: 1, history: [], ...extra });

test('a first save has count 1; saving the same crop to the same card again is x2 and keeps the first why-record', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await storeCorrection(store, draft({ why: { w: 1, src: 'picture' } }), { now: NOW });
  const second = await storeCorrection(store, draft({ ts: NOW + 1, via: 'candidates', why: { w: 1, src: 'user' } }), { now: NOW });
  assert.equal(second.count, 2);
  const [row] = await store.all();
  assert.equal(row.count, 2);
  assert.deepEqual(row.history.map((h) => [h.pickedId, h.why.src]), [['a', 'picture']]);
});

test('a contradicting correction replaces the answer and keeps the earlier one', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await storeCorrection(store, draft(), { now: NOW });
  await storeCorrection(store, draft({ ts: NOW + 1, pickedId: 'b' }), { now: NOW });
  const [row] = await store.all();
  assert.equal(row.pickedId, 'b');
  assert.equal(row.count, 1);
  assert.equal(row.history[0].pickedId, 'a');
});

test('the old reference of a replaced answer is deleted', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await storeCorrection(store, draft(), { now: NOW });
  await store.saveReference({ id: 's:0', cardId: 'a', ts: NOW, v: 3, embedding: new Float32Array(2) });
  await storeCorrection(store, draft({ ts: NOW + 1, pickedId: 'b' }), { now: NOW });
  assert.equal(await store.countReferences(), 0);
});

test('a Japanese pick is kept as an answer without its picture, so no reference vector is ever made for it', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  const record = await storeCorrection(store, draft({ pickedId: 'jp-709157' }), { now: NOW });
  assert.equal(record.pickedId, 'jp-709157');
  assert.equal(record.crop, null);
  assert.equal(record.count, 1);
  const [row] = await store.all();
  assert.equal(row.pickedId, 'jp-709157');
  assert.equal(row.crop, null);
  const heads = await store.correctionHeads();
  assert.equal(heads[0].hasCrop, false);
  assert.deepEqual(correctionsToEmbed(heads, await store.allReferences()), []);
  // An English pick still keeps its picture and is embedded.
  await storeCorrection(store, draft({ id: 's:1', index: 1, pickedId: 'a' }), { now: NOW });
  assert.deepEqual(correctionsToEmbed(await store.correctionHeads(), []).map((c) => c.id), ['s:1']);
});

test('a Japanese answer counts toward the cap and is evicted like any other, and its replacement by an English one keeps the picture', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 'x', ts: NOW - 90 * DAY, pickedId: 'a' });
  await storeCorrection(store, draft({ pickedId: 'jp-1' }), { max: 1, now: NOW });
  assert.deepEqual((await store.all()).map((r) => r.id), ['s:0']);
  await storeCorrection(store, draft({ ts: NOW + 1, pickedId: 'b' }), { max: 1, now: NOW });
  const [row] = await store.all();
  assert.equal(row.pickedId, 'b');
  assert.equal(row.crop, 'data:image/jpeg;base64,AA');
  assert.equal(row.history[0].pickedId, 'jp-1');
});

test('the cap evicts the oldest unprotected corrections and their references, never an x2 or a recent one first', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 'old-x2', ts: NOW - 300 * DAY, pickedId: 'a', count: 2 });
  await store.save({ id: 'old', ts: NOW - 100 * DAY, pickedId: 'b' });
  await store.save({ id: 'older', ts: NOW - 200 * DAY, pickedId: 'c' });
  await store.save({ id: 'new', ts: NOW - DAY, pickedId: 'd' });
  await store.saveReference({ id: 'older', cardId: 'c', ts: NOW - 200 * DAY, v: 3, embedding: new Float32Array(2) });
  const gone = await evictCorrections(store, 2, NOW);
  assert.deepEqual(gone, ['older', 'old']);
  assert.deepEqual((await store.all()).map((r) => r.id).sort(), ['new', 'old-x2']);
  assert.equal(await store.countReferences(), 0);
});

test('saving over the cap evicts in the same call', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 'x', ts: NOW - 90 * DAY, pickedId: 'a' });
  await storeCorrection(store, draft(), { max: 1, now: NOW });
  assert.deepEqual((await store.all()).map((r) => r.id), ['s:0']);
});

test('a full disk: room is made, then the answer is kept without its picture if it still does not fit', async () => {
  const real = createCorrectionsStore(fakeIndexedDB());
  await real.save({ id: 'old', ts: NOW - 90 * DAY, pickedId: 'z' });
  const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  let calls = 0;
  const store = { ...real, save: async (row) => { calls += 1; if (row.crop && calls <= 2) throw quota; return real.save(row); } };
  const record = await storeCorrection(store, draft(), { now: NOW });
  assert.equal(record.pickedId, 'a');
  const saved = (await real.all()).find((r) => r.id === 's:0');
  assert.equal(saved.pickedId, 'a');
  assert.equal(saved.crop, null);
});

test('an error that is not about space is thrown', async () => {
  const real = createCorrectionsStore(fakeIndexedDB());
  const store = { ...real, save: async () => { throw new Error('boom'); } };
  await assert.rejects(storeCorrection(store, draft(), { now: NOW }), /boom/);
});

test('agreeWithReference: confirming the corrected card again from another crop counts x2 and stores no new row', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 's1:0', ts: NOW - DAY, pickedId: 'a', crop: 'x' });
  const msg = { scanId: 's2', index: 3, pickedId: 'a', guess: { memory: { refId: 's1:0', cardId: 'a' } } };
  assert.deepEqual(await agreeWithReference(store, msg, NOW), { count: 2 });
  const [row] = await store.all();
  assert.equal(row.count, 2);
  assert.equal(row.lastAgreed, NOW);
  assert.equal(row.crop, 'x');
  assert.equal(await store.count(), 1);
});

test('agreeWithReference: not when another card is picked, the reference is gone, or it is the same row', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 's1:0', ts: 1, pickedId: 'a' });
  const guess = { memory: { refId: 's1:0', cardId: 'a' } };
  assert.equal(await agreeWithReference(store, { scanId: 's2', index: 0, pickedId: 'b', guess }, NOW), null);
  assert.equal(await agreeWithReference(store, { scanId: 's2', index: 0, pickedId: 'a', guess: { memory: { refId: 'gone', cardId: 'a' } } }, NOW), null);
  assert.equal(await agreeWithReference(store, { scanId: 's1', index: 0, pickedId: 'a', guess }, NOW), null);
  assert.equal(await agreeWithReference(store, { scanId: 's2', index: 0, pickedId: 'a', guess: {} }, NOW), null);
});

test('an old row with no why, count or history is read, extended and still saved', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 's:0', ts: 5, pickedId: 'a', via: 'search' });
  const record = await storeCorrection(store, draft(), { now: NOW });
  assert.equal(record.count, 2);
  assert.equal(record.history[0].pickedId, 'a');
});

import { holdExamPick } from '../tools/extension-wasm/lib/correction-save.js';

const examScan = { scanId: 's', shares: [{ split: 'exam', photoId: 'p' }, { split: 'teach', photoId: 'q' }], examPicks: {} };

test('an exam-split pick is queued for the exam only when sharing is on, and never for a teach photo', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.saveScan({ ...examScan, ts: 1, crops: [] });
  const msg = { scanId: 's', index: 0, pickedId: 'a', via: 'wrong-card' };
  assert.equal(await holdExamPick(store, examScan, msg, false), false);
  assert.deepEqual((await store.getScan('s')).examPicks, {});
  assert.equal(await holdExamPick(store, examScan, msg, true), true);
  assert.deepEqual((await store.getScan('s')).examPicks, { 0: { cardId: 'a', source: 'wrong-card' } });
  assert.equal(await holdExamPick(store, examScan, { ...msg, index: 1 }, true), false);
});

test('a correction on an exam-split photo is stored locally either way, and its reference is used on rescan', async () => {
  const { currentReferences } = await import('../tools/extension-wasm/lib/references.js');
  for (const sharing of [false, true]) {
    const store = createCorrectionsStore(fakeIndexedDB());
    await store.saveScan({ ...examScan, ts: 1, crops: [] });
    await holdExamPick(store, examScan, { scanId: 's', index: 0, pickedId: 'a', via: 'search' }, sharing);
    const record = await storeCorrection(store, draft(), { now: NOW });
    assert.equal(await store.count(), 1);
    const heads = await store.correctionHeads();
    const ref = { id: record.id, cardId: 'a', ts: record.ts, v: (await import('../tools/extension-wasm/lib/embed.js')).EMBEDDING_VERSION, embedding: new Float32Array(512) };
    assert.equal(currentReferences([ref], heads).length, 1);
  }
});

test('agreeWithReference: not when this crop already holds a different answer, so the normal path replaces it (finding 15)', async () => {
  const store = createCorrectionsStore(fakeIndexedDB());
  await store.save({ id: 'old:0', ts: NOW - DAY, pickedId: 'b', crop: 'x' });
  await store.save({ id: 's2:3', ts: NOW, pickedId: 'a', crop: 'y' });
  const msg = { scanId: 's2', index: 3, pickedId: 'b', guess: { memory: { refId: 'old:0', cardId: 'b' } } };
  assert.equal(await agreeWithReference(store, msg, NOW), null);
  assert.equal((await store.getCorrection('old:0')).count || 1, 1);
  // The same answer already on this crop still counts as agreement.
  await store.save({ id: 's2:3', ts: NOW, pickedId: 'b', crop: 'y' });
  assert.deepEqual(await agreeWithReference(store, msg, NOW), { count: 2 });
});

import { serializeByScan, settleExamPick } from '../tools/extension-wasm/lib/correction-save.js';

test('exam holds for one scan run one at a time, so concurrent picks all survive (finding 17)', async () => {
  let saved = { shares: { 1: { split: 'exam' }, 2: { split: 'exam' }, 3: { split: 'exam' } } };
  const later = () => new Promise((resolve) => setTimeout(resolve, 5));
  const store = { getScan: async () => { await later(); return saved; }, saveScan: async (s) => { await later(); saved = s; } };
  await Promise.all([1, 2, 3].map((index) => serializeByScan('s', async () => {
    const scan = await store.getScan('s');
    await settleExamPick(store, scan, { index, pickedId: `c${index}`, via: 'candidates' }, { holdAllowed: true, sharingEnabled: async () => true });
  })));
  assert.deepEqual(Object.keys(saved.examPicks).sort(), ['1', '2', '3']);
});
