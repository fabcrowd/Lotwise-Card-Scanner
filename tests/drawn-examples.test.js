import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DRAWN_KINDS, MAX_DRAWN_EXAMPLES, createDrawnExamplesStore, drawnKind, newExampleId,
} from '../tools/extension-wasm/lib/drawn-examples-store.js';
import { placeDrawnCard, drawnCardEntry } from '../tools/extension-wasm/lib/draw-box.js';
import { notCardEntry } from '../tools/extension-wasm/lib/not-card.js';
import { tooSmallCard } from '../tools/extension-wasm/lib/tiny-card.js';
import { EXCLUDE_FILES, STRIP_FILES, stripDevBlocks } from '../scripts/lib/store-package.mjs';
import { fakeIndexedDB } from './helpers/fake-idb.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'extension-wasm');
const source = (file) => readFileSync(path.join(root, file), 'utf8');

const example = (ts, extra = {}) => ({ id: newExampleId(ts), ts, kind: null, box: [1, 2, 3, 4], ...extra });

// The store

test('adds, lists, counts and clears examples in a database of its own', async () => {
  const idb = fakeIndexedDB();
  const store = createDrawnExamplesStore(idb);
  assert.equal(await store.count(), 0);
  const first = await store.add(example(1000, { pageUrl: 'https://x.test/a' }));
  const second = await store.add(example(2000));
  assert.equal(typeof first, 'string');
  assert.equal(await store.count(), 2);
  assert.deepEqual((await store.list()).map((e) => e.id), [first, second]);
  assert.notEqual(idb.opened[0].name, 'card-scanner');
  await store.clear();
  assert.equal(await store.count(), 0);
  assert.deepEqual(await store.list(), []);
});

test('add gives an example without an id one', async () => {
  const store = createDrawnExamplesStore(fakeIndexedDB());
  const id = await store.add({ ts: 5, kind: null });
  assert.equal((await store.list())[0].id, id);
});

test('keeps only the newest MAX_DRAWN_EXAMPLES and drops the oldest', async () => {
  assert.equal(MAX_DRAWN_EXAMPLES, 200);
  const store = createDrawnExamplesStore(fakeIndexedDB());
  for (let i = 1; i <= MAX_DRAWN_EXAMPLES + 3; i += 1) await store.add(example(i * 10, { n: i }));
  const kept = await store.list();
  assert.equal(kept.length, MAX_DRAWN_EXAMPLES);
  assert.equal(kept[0].n, 4);
  assert.equal(kept.at(-1).n, MAX_DRAWN_EXAMPLES + 3);
});

test('setKind records the kind on a stored example and reports a missing one', async () => {
  const store = createDrawnExamplesStore(fakeIndexedDB());
  const id = await store.add(example(1));
  assert.equal(await store.setKind(id, 'missed'), true);
  assert.equal((await store.list())[0].kind, 'missed');
  assert.equal(await store.setKind('nope', 'missed'), false);
  assert.equal(await store.count(), 1);
});

test('a failed open rejects', async () => {
  const store = createDrawnExamplesStore(fakeIndexedDB({ failOpen: true }));
  await assert.rejects(store.count(), /blocked/);
  await assert.rejects(createDrawnExamplesStore(null).count(), /not available/);
});

// The kind

test('the kind follows what the drawn box replaced', () => {
  assert.deepEqual(DRAWN_KINDS, ['hidden', 'tooSmall', 'missed']);
  assert.equal(drawnKind(notCardEntry({ box: [0, 0, 10, 10], score: 0.4, readHeight: 10, via: 'x', unread: true })), 'hidden');
  assert.equal(drawnKind(tooSmallCard({ box: [0, 0, 10, 10], score: null, readHeight: 10 })), 'tooSmall');
  assert.equal(drawnKind(null), 'missed');
  assert.equal(drawnKind(undefined), 'missed');
});

test('placeDrawnCard also says what it replaced, and keeps its other fields', () => {
  const hidden = notCardEntry({ box: [0, 0, 100, 140], score: 0.4, readHeight: 140, via: 'yolo-in-photo', unread: true });
  const entry = drawnCardEntry({ box: [5, 5, 105, 145], read: { box: null, identity: null, confidence: 0, abstain: true }, readHeight: 140 });
  const over = placeDrawnCard([hidden], entry);
  assert.equal(over.replacedCard, hidden);
  assert.equal(over.replaced, true);
  assert.equal(over.index, 0);
  const apart = placeDrawnCard([hidden], drawnCardEntry({ box: [900, 0, 1000, 140], tooSmall: true, readHeight: 140 }));
  assert.equal(apart.replacedCard, null);
  assert.equal(apart.replaced, false);
});

// Dev build only, and never in the draw flow's way

test('the store package strips the new code and leaves nothing of it behind', () => {
  assert.ok(EXCLUDE_FILES.includes('lib/drawn-examples-store.js'));
  for (const file of ['background.js', 'popup.js', 'options.js', 'options.html']) assert.ok(STRIP_FILES.includes(file), file);
  const gone = /drawn-examples|drawnExample|DrawnExample|drawnPlaced|DRAWN_KINDS|drawnKind|Drawn boxes for training/;
  for (const file of ['background.js', 'popup.js', 'options.js', 'options.html']) {
    assert.match(source(file), gone, `${file} should carry it in the dev build`);
    assert.doesNotMatch(stripDevBlocks(source(file), file), gone, `${file} must not carry it in the store build`);
  }
});

test('the draw flow sends the card before it records anything, and recording cannot throw into it', () => {
  const bg = source('background.js');
  const flow = bg.slice(bg.indexOf('async function handleDrawnBox'), bg.indexOf('const DRAW_OFF_PHOTO'));
  assert.ok(flow.indexOf('tell(message)') > 0);
  assert.ok(flow.indexOf('tell(message)') < flow.indexOf('recordDrawnExample('), 'recorded after the message is sent');
  const recorder = bg.slice(bg.indexOf('function recordDrawnExample'));
  assert.match(recorder.slice(0, recorder.indexOf('\n}\n')), /\.catch\(/);
});

test('the background accepts a placed kind only from the extension\'s own pages and only for a known kind', () => {
  const bg = source('background.js');
  const handler = bg.slice(bg.indexOf('drawnPlaced: async'));
  assert.match(handler.slice(0, 400), /DRAWN_KINDS\.includes\(msg\.kind\)/);
  // Own-page actions are only reachable through handleOwnPageMessage, which checks isOwnPage first.
  const gate = bg.slice(bg.indexOf('function handleOwnPageMessage'));
  assert.match(gate.slice(0, 200), /isOwnPage\(sender/);
  assert.ok(bg.indexOf('drawnPlaced: async') < bg.indexOf('function handleOwnPageMessage'));
});

test('popup CLEAR and rescans never touch the log', () => {
  const popup = source('popup.js');
  assert.doesNotMatch(popup, /clearDrawnExamples/);
  assert.doesNotMatch(source('background.js').slice(0, source('background.js').indexOf('clearDrawnExamples: async')), /_drawnExamples\.clear/);
});
