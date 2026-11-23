import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  JA_ASSET, JA_AUTO, JA_MARGIN, JA_MIN_HEIGHT,
  chooseCandidates, findJaCards, gunzip, isJaId, japaneseCandidates, japaneseRead, japaneseVerdict, mergeSearchResults, parseJaCatalog, searchAll, searchJa,
} from '../tools/extension-wasm/lib/japanese.js';
import { applyMemory, correctionsToEmbed, referenceRow, referencesForExport } from '../tools/extension-wasm/lib/references.js';
import { JAPANESE_REASON } from '../tools/extension-wasm/lib/why-text.js';
import { OPTIONAL_ASSETS } from '../tools/extension-wasm/lib/setup.js';
import { asLowCertaintyGuess } from '../tools/extension-wasm/lib/card-picker.js';
import { scannerOf } from '../tools/extension-wasm/lib/contribution.js';
import { stripDevBlocks } from '../scripts/lib/store-package.mjs';

const root = path.join(import.meta.dirname, '..', 'tools', 'extension-wasm');
const EXPECTED = { query: 'aaaaaaaaaaaaaaaa', crop: 3 };
const DIM = 512;

const CARDS = [
  { pid: 709157, gid: 24791, name: 'Heracross', set: 'M6: Storm Emeralda', number: '001/076' },
  { pid: 709158, gid: 24791, name: 'Charizard ex', set: 'M6: Storm Emeralda', number: '012/076' },
  { pid: 709159, gid: 24791, name: 'Pikachu', set: 'M6: Storm Emeralda', number: '112/076' },
];

// Quantised the way the builder script does it: scale = max|v| / 127, q = round(v / scale), stored scale = 1 / norm(q).
function quantise(v) {
  const scale = Math.max(...v.map(Math.abs)) / 127;
  const q = v.map((x) => Math.round(x / scale));
  const norm = Math.sqrt(q.reduce((s, x) => s + x * x, 0));
  return { q, scale: 1 / norm };
}

function unit(rand) {
  const v = Array.from({ length: DIM }, () => rand() - 0.5);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

function lcg(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function build({ header = {}, cards = CARDS, vectors, trim = 0, pad = 0 } = {}) {
  const rand = lcg(7);
  const vecs = vectors ?? cards.map(() => unit(rand));
  const head = { v: 1, dim: DIM, entries: cards.length, rows: 'bbbbbbbbbbbbbbbb', query: EXPECTED.query, crop: EXPECTED.crop, built: '2026-11-17', cards, ...header };
  const json = new TextEncoder().encode(JSON.stringify(head));
  const n = vecs.length;
  const body = new Uint8Array(4 + json.length + pad + n * 4 + n * DIM);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  const view = new DataView(body.buffer);
  const start = 4 + json.length + pad;
  vecs.forEach((v, i) => {
    const { q, scale } = quantise(v);
    view.setFloat32(start + i * 4, scale, true);
    q.forEach((x, d) => { body[start + n * 4 + i * DIM + d] = x & 0xff; });
  });
  return { bytes: body.subarray(0, body.length - trim), vecs };
}

const make = build;

test('a small generated file parses into cards, scales and rows', () => {
  const { bytes } = make();
  const ja = parseJaCatalog(bytes, EXPECTED);
  assert.equal(ja.n, 3);
  assert.equal(ja.scales.length, 3);
  assert.equal(ja.rows.length, 3 * DIM);
  assert.deepEqual(ja.cards[0], {
    id: 'jp-709157', name: 'Heracross', set: 'M6: Storm Emeralda (Japanese)', number: '001/076',
    imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/709157_200w.jpg', lang: 'ja', tcgPlayerId: 709157, groupId: 24791,
  });
});

test('a file is read even when its bytes do not start on an aligned offset', () => {
  const { bytes } = make();
  const shifted = new Uint8Array(bytes.length + 1);
  shifted.set(bytes, 1);
  assert.equal(parseJaCatalog(shifted.subarray(1), EXPECTED).n, 3);
});

test('gunzip returns the bytes that were compressed', async () => {
  const { bytes } = make();
  const back = await gunzip(gzipSync(bytes));
  assert.deepEqual(back, new Uint8Array(bytes));
});

const reject = (opts, pattern, expected = EXPECTED) => assert.throws(() => parseJaCatalog(make(opts).bytes, expected), pattern);

test('a file with a bad layout is rejected with a clear message', () => {
  reject({ header: { v: 2 } }, /version 2/);
  reject({ header: { dim: 256 } }, /dimension 256/);
  reject({ header: { entries: 2 } }, /do not match/);
  reject({ trim: 1 }, /wrong size/);
  reject({ pad: 1 }, /wrong size/);
  assert.throws(() => parseJaCatalog(new Uint8Array([1, 2]), EXPECTED), /too short/);
  assert.throws(() => parseJaCatalog(new Uint8Array([255, 255, 255, 0, 1]), EXPECTED), /header runs past/);
});

test('a card with a bad field is rejected', () => {
  const bad = (over) => [{ ...CARDS[0], ...over }];
  reject({ cards: bad({ pid: 1.5 }) }, /pid and gid/);
  reject({ cards: bad({ gid: '7' }) }, /pid and gid/);
  reject({ cards: bad({ name: '' }) }, /bad name/);
  reject({ cards: bad({ set: 5 }) }, /bad set/);
  reject({ cards: bad({ number: undefined }) }, /bad number/);
  reject({ cards: bad({ name: 'x'.repeat(201) }) }, /bad name/);
  assert.doesNotThrow(() => parseJaCatalog(make({ cards: bad({ name: 'x'.repeat(200) }) }).bytes, EXPECTED));
});

test('a file with too many cards is rejected before its size is checked', () => {
  reject({ header: { entries: 100_001 } }, /out of range/);
});

test('a file fitted for another recognizer or crop is not used', () => {
  reject({}, /another recognizer/, { query: 'cccccccccccccccc', crop: EXPECTED.crop });
  reject({}, /another crop/, { query: EXPECTED.query, crop: EXPECTED.crop + 1 });
});

test('searchJa agrees with a float computation to within 0.001', () => {
  const rand = lcg(11);
  const vectors = Array.from({ length: 40 }, () => unit(rand));
  const cards = vectors.map((_, i) => ({ pid: 1000 + i, gid: 1, name: `Card ${i}`, set: 'S', number: String(i + 1) }));
  const ja = parseJaCatalog(make({ cards, vectors }).bytes, EXPECTED);
  const query = unit(rand);
  const hits = searchJa(ja, query, 40);
  assert.equal(hits.length, 40);
  for (const { index, score } of hits) {
    const exact = vectors[index].reduce((s, x, d) => s + x * query[d], 0);
    assert.ok(Math.abs(score - exact) < 0.001, `${index}: ${score} vs ${exact}`);
  }
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
  assert.equal(searchJa(ja, query, 3).length, 3);
  assert.deepEqual(searchJa(ja, query, 3).map((h) => h.index), hits.slice(0, 3).map((h) => h.index));
});

test('isJaId is true only for jp- ids', () => {
  assert.equal(isJaId('jp-709157'), true);
  assert.equal(isJaId('base1-58'), false);
  assert.equal(isJaId(null), false);
  assert.equal(isJaId(undefined), false);
  assert.equal(isJaId(42), false);
});

test('the Japanese rule needs the margin, the height and the switch', () => {
  // bestEn 0 keeps the difference exact in floating point, so "at the margin" is really at it.
  const ok = { bestJa: JA_MARGIN, bestEn: 0, height: JA_MIN_HEIGHT };
  assert.equal(japaneseVerdict(ok, { auto: true }), true);
  assert.equal(japaneseVerdict({ ...ok, bestJa: JA_MARGIN - 0.0005 }, { auto: true }), false);
  assert.equal(japaneseVerdict({ ...ok, height: JA_MIN_HEIGHT - 1 }, { auto: true }), false);
  assert.equal(japaneseVerdict({ ...ok, height: JA_MIN_HEIGHT + 50, bestJa: 0.9 }, { auto: true }), true);
  assert.equal(japaneseVerdict(ok, { auto: false }), false);
  // With no rule given the exported constants decide.
  assert.equal(japaneseVerdict(ok), JA_AUTO);
  assert.equal(japaneseVerdict({ ...ok, height: JA_MIN_HEIGHT - 1 }), false);
});

test('the rule can be given other numbers by a test', () => {
  const read = { bestJa: 0.75, bestEn: 0.5, height: 100 };
  assert.equal(japaneseVerdict(read, { auto: true, margin: 0.25, minHeight: 100 }), true);
  assert.equal(japaneseVerdict(read, { auto: true, margin: 0.26, minHeight: 100 }), false);
});

const ja = (n) => Array.from({ length: n }, (_, i) => ({ id: `jp-${i}`, name: `J${i}` }));
const en = (n) => Array.from({ length: n }, (_, i) => ({ id: `en-${i}`, name: `E${i}` }));

test('candidates: four Japanese cards, then the first English one', () => {
  assert.deepEqual(japaneseCandidates(ja(5), en(5)).map((c) => c.id), ['jp-0', 'jp-1', 'jp-2', 'jp-3', 'en-0']);
});

test('candidates: fewer Japanese cards leave room for more English ones, up to five', () => {
  assert.deepEqual(japaneseCandidates(ja(2), en(5)).map((c) => c.id), ['jp-0', 'jp-1', 'en-0', 'en-1', 'en-2']);
  assert.deepEqual(japaneseCandidates(ja(0), en(2)).map((c) => c.id), ['en-0', 'en-1']);
  assert.deepEqual(japaneseCandidates(ja(6), []).map((c) => c.id), ['jp-0', 'jp-1', 'jp-2', 'jp-3', 'jp-4']);
});

test('candidates: no id appears twice', () => {
  const dup = [{ id: 'jp-1' }, { id: 'jp-1' }, { id: 'jp-2' }];
  assert.deepEqual(japaneseCandidates(dup, [{ id: 'jp-2' }, { id: 'e' }]).map((c) => c.id), ['jp-1', 'jp-2', 'e']);
});

const parsed = () => parseJaCatalog(make().bytes, EXPECTED);

test('findJaCards finds by name words', () => {
  assert.deepEqual(findJaCards(parsed(), 'charizard').map((c) => c.name), ['Charizard ex']);
  assert.deepEqual(findJaCards(parsed(), 'zzz'), []);
  assert.deepEqual(findJaCards(parsed(), ''), []);
});

test('findJaCards finds by number with or without leading zeros', () => {
  assert.deepEqual(findJaCards(parsed(), '1').map((c) => c.name), ['Heracross']);
  assert.deepEqual(findJaCards(parsed(), '001').map((c) => c.name), ['Heracross']);
  assert.deepEqual(findJaCards(parsed(), '#012').map((c) => c.name), ['Charizard ex']);
  assert.deepEqual(findJaCards(parsed(), 'pikachu 112').map((c) => c.name), ['Pikachu']);
});

test('findJaCards ignores a typed set total', () => {
  assert.deepEqual(findJaCards(parsed(), '1/999').map((c) => c.name), ['Heracross']);
  assert.deepEqual(findJaCards(parsed(), '112/076').map((c) => c.name), ['Pikachu']);
  assert.deepEqual(findJaCards(parsed(), 'heracross 001/076').map((c) => c.name), ['Heracross']);
});

test('search results keep 12 of the row group and 8 of the other, and hand on unused slots', () => {
  const ids = (list) => list.map((c) => c.id);
  const out = mergeSearchResults(en(20), ja(20));
  assert.equal(out.length, 20);
  assert.deepEqual(ids(out.slice(0, 12)), ids(en(12)));
  assert.deepEqual(ids(out.slice(12)), ids(ja(8)));
  const jaRow = mergeSearchResults(en(20), ja(20), true);
  assert.deepEqual(ids(jaRow.slice(0, 12)), ids(ja(12)));
  assert.deepEqual(ids(jaRow.slice(12)), ids(en(8)));
  assert.equal(mergeSearchResults(en(3), ja(20)).length, 20);
  assert.equal(mergeSearchResults(en(3), ja(20)).filter((c) => isJaId(c.id)).length, 17);
  assert.equal(mergeSearchResults(en(30), ja(2)).length, 20);
  assert.deepEqual(mergeSearchResults(en(2), ja(0)), en(2));
  assert.deepEqual(mergeSearchResults([], []), []);
});

test('a stored jp- reference can never change the English hits, throw, or break an export', async () => {
  const rand = lcg(3);
  const query = unit(rand);
  const meta = [{ id: 'base1-4' }, { id: 'base1-5' }, { id: 'base1-6' }];
  const hits = [{ index: 0, score: 0.3 }, { index: 1, score: 0.29 }, { index: 2, score: 0.28 }];
  const jpRow = referenceRow({ id: 's:0', pickedId: 'jp-709157', ts: 1, count: 1, wrongId: 'base1-4' }, Float32Array.from(query));
  const far = referenceRow({ id: 's:1', pickedId: 'jp-709158', ts: 1, count: 1 }, Float32Array.from(unit(rand)));
  for (const rows of [[jpRow], [jpRow, far], [far]]) {
    const out = applyMemory(Float32Array.from(query), rows, hits, 0.3, meta, { height: 400 });
    assert.deepEqual(out.hits, hits);
    assert.notEqual(out.referencedId, 'jp-709157');
  }
  // With an English reference as well, a jp row never appears as a hit.
  const english = referenceRow({ id: 's:2', pickedId: 'base1-5', ts: 1, count: 1 }, Float32Array.from(query));
  const mixed = applyMemory(Float32Array.from(query), [jpRow, english], hits, 0.3, meta, { height: 400 });
  assert.ok(mixed.hits.every((hit) => meta[hit.index]?.id?.startsWith('base1-')));
  // An export with a Japanese answer and no picture embeds nothing for it and keeps its row.
  const heads = [{ id: 's:0', ts: 1, pickedId: 'jp-709157', hasCrop: false, count: 1 }];
  assert.deepEqual(correctionsToEmbed(heads, []), []);
  const exported = await referencesForExport({ heads, refs: [], getCorrection: async () => null, embedCrop: async () => assert.fail('nothing to embed'), onEmbedded: async () => {} });
  assert.deepEqual(exported.rows, []);
  assert.equal(exported.failed, 0);
});

test('a read treated as Japanese is not turned into an English best guess', () => {
  const read = { identity: null, abstain: true, confidence: 0, catalogTop: 0.9, nearest: ['base1-58'], japanese: true };
  assert.equal(asLowCertaintyGuess(read, () => ({ id: 'base1-58' })), read);
  const plain = { ...read, japanese: undefined };
  assert.equal(asLowCertaintyGuess(plain, () => ({ id: 'base1-58' })).lowCertainty, true);
});

test('the Japanese catalog pin is the real file\'s hash, not the all-zero stand-in', () => {
  const asset = OPTIONAL_ASSETS.find((a) => a.name === JA_ASSET);
  assert.ok(asset, 'catalog-ja.bin.gz is in OPTIONAL_ASSETS');
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(asset.sha256, '0'.repeat(64));
});

test('the Japanese catalog is an optional file of release v3.2', () => {
  const asset = OPTIONAL_ASSETS.find((a) => a.name === 'catalog-ja.bin.gz');
  assert.equal(asset.release, 'v3.2');
});

const withVectors = () => {
  const { bytes, vecs } = make();
  return { ja: parseJaCatalog(bytes, EXPECTED), vecs };
};

test('japaneseRead: a crop that matches a Japanese card better than any English one is a Japanese read', () => {
  const { ja, vecs } = withVectors();
  const read = japaneseRead(ja, vecs[1], { bestEn: 0.2, height: JA_MIN_HEIGHT }, { auto: true, margin: 0.01 });
  assert.equal(read.japanese, true);
  assert.equal(read.identity, null);
  assert.equal(read.abstain, true);
  assert.equal(read.confidence, 0);
  assert.equal(read.jaNearest[0], 'jp-709158');
  assert.ok(read.bestJa > 0.99 && read.bestJa <= 1.001);
  assert.equal(read.jaNearest.length, 3);
  assert.equal(read.market_price, null);
  assert.equal(read.price_variant, null);
  assert.equal(read.price_grid, null);
});

test('japaneseRead: null when the English cards are as close, the card is small, or the rule is off', () => {
  const { ja, vecs } = withVectors();
  const rule = { auto: true, margin: 0.01, minHeight: 150 };
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0.99, height: 400 }, rule), null);
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0.2, height: 149 }, rule), null);
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0.2, height: 400 }, { ...rule, auto: false }), null);
  assert.equal(japaneseRead(null, vecs[1], { bestEn: 0.2, height: 400 }, rule), null);
  // No English score to compare with: no physical English hit, so nothing is called Japanese.
  for (const bestEn of [0, -0.1, undefined, null, NaN, Infinity, '0.2']) {
    assert.equal(japaneseRead(ja, vecs[1], { bestEn, height: 400 }, rule), null, String(bestEn));
  }
});

test('chooseCandidates: a Japanese card gets its Japanese cards first, any other card keeps the English list', () => {
  const byId = new Map(ja(5).map((c) => [c.id, c]));
  const english = en(5);
  const asked = { japanese: true, jaNearest: ['jp-0', 'jp-1', 'jp-9'] };
  assert.deepEqual(chooseCandidates(asked, english, byId).map((c) => c.id), ['jp-0', 'jp-1', 'en-0', 'en-1', 'en-2']);
  assert.equal(chooseCandidates({ identity: { id: 'x' } }, english, byId), english);
  assert.deepEqual(chooseCandidates(asked, english, null).map((c) => c.id), ['en-0', 'en-1', 'en-2', 'en-3', 'en-4']);
});

test('searchAll: English only when there is no Japanese catalog, merged with it when there is', () => {
  const english = en(3);
  assert.equal(searchAll(english, null, 'x', false), english);
  const catalog = parsed();
  const out = searchAll(english, catalog, 'pikachu', false);
  assert.deepEqual(out.map((c) => c.id), ['en-0', 'en-1', 'en-2', 'jp-709159']);
  assert.deepEqual(searchAll(english, catalog, 'pikachu', true).map((c) => c.id), ['jp-709159', 'en-0', 'en-1', 'en-2']);
});

test('sharing: a Japanese identity is never reported as the scanner\'s card', () => {
  assert.deepEqual(scannerOf({ identity: { id: 'jp-709157' }, confidence: 0.9 }), { cardId: null, confidence: 0.9, stripe: 'none' });
  assert.deepEqual(scannerOf({ identity: { id: 'base1-58' }, confidence: 0.9 }), { cardId: 'base1-58', confidence: 0.9, stripe: 'high' });
});

// The wiring in background.js has no unit seam, so these pins read its text, as tests/lookalike-setting.test.js does.
const background = stripDevBlocks(readFileSync(path.join(root, 'background.js'), 'utf8'), 'background.js');
const bodyOf = (name) => {
  const at = background.indexOf(name);
  assert.ok(at >= 0, `${name} is in background.js`);
  return background.slice(at, at + 700);
};

test('sharing: a pick of a Japanese card, or on a Japanese row, returns before anything is contributed', () => {
  const body = bodyOf('async function contributeTeachPick');
  assert.ok(body.indexOf('if (keepsNoPicture(msg)) return;') > 0 && body.indexOf('if (keepsNoPicture(msg)) return;') < body.indexOf('_sharing.enabled'));
  // keepsNoPicture is true for both kinds (tested above): the English pick on a flagged row and the Japanese pick on any row.
  assert.equal(keepsNoPicture({ guess: { japanese: true }, pickedId: 'sv1-9' }), true);
  assert.equal(keepsNoPicture({ guess: {}, pickedId: 'jp-709157' }), true);
  assert.equal(keepsNoPicture({ guess: {}, pickedId: 'sv1-9' }), false);
});

test('sharing: the exam hold is skipped for a Japanese pick, which clears an earlier held answer instead', () => {
  assert.match(background, /await settleExamPick\(_corrections, scan, msg, \{ holdAllowed: examHoldAllowed\(msg\)/);
});

test('English lookups stay English: only the price lookup and a saved pick use anyCard', () => {
  assert.equal(background.match(/\banyCard\(/g).length, 2);
  assert.match(background, /const identity = anyCard\(id\)/);
  assert.match(background, /if \(!anyCard\(msg\.pickedId\)\)/);
  assert.match(background, /const known = \(id\) => Boolean\(catalogCard\(id\)\)/);
});

test('the Japanese catalog is never added to the English list or search', () => {
  assert.doesNotMatch(background, /_meta\s*=\s*\[[^\]]*_ja/);
  assert.doesNotMatch(background, /searchCatalog\([^)]*_ja/);
  assert.equal(background.match(/await searchBoth\(embedding\)/g).length, 2);
});

test('the Japanese catalog loads from the setting, expecting the recognizer and crop tags', () => {
  assert.match(background, /japaneseCards !== false/);
  assert.match(background, /parseJaCatalog\(await gunzip\(buffer\), \{ query: clip, crop \}\)/);
  assert.match(background, /\[BG\] Japanese catalog not available/);
});

test('a scan and a detect read call japaneseRead after the card-back check and before the English reads', () => {
  const scan = background.slice(background.indexOf('async function recognizeWith'));
  assert.ok(scan.indexOf('isCardBack(') < scan.indexOf('japaneseRead(') && scan.indexOf('japaneseRead(') < scan.indexOf('withReferenceHit('));
  assert.match(scan, /japaneseRead\(await activeJapaneseCatalog\(\), embedding, \{ bestEn: rawTop, height: sourceHeight \}\)/);
  const detect = background.slice(background.indexOf('async function handleDetect'));
  assert.ok(detect.indexOf('isCardBack(') < detect.indexOf('japaneseRead(') && detect.indexOf('japaneseRead(') < detect.indexOf('withReferenceHit('));
  assert.match(detect, /height: box\[3\] - box\[1\]/);
});

test('the three candidate lists of unsure cards go through candidatesWithJapanese', () => {
  assert.equal(background.match(/candidatesWithJapanese\(/g).length, 3);
  assert.doesNotMatch(background, /candidates: candidatesFor\(/);
});

test('a Japanese id is priced from tcgcsv before any English lookup, and waits for the catalog when picked', () => {
  const price = background.slice(background.indexOf('async function priceIdentity'));
  assert.ok(price.indexOf('isJaId(identity.id)') > 0 && price.indexOf('isJaId(identity.id)') < price.indexOf('getTcgdexCard('));
  assert.match(price, /await jaLookup\(identity, _jaPrices, Date\.now\(\)\)/);
  assert.match(price, /if \(!failed\) _scanPriceCache\.set\(cacheKey, japanesePrice\)/);
  const pick = background.slice(background.indexOf('async function handlePriceCard'));
  assert.ok(pick.indexOf('await _loadJapaneseCatalog()') > 0 && pick.indexOf('await _loadJapaneseCatalog()') < pick.indexOf('anyCard(id)'));
});

test('the typed search goes through searchAll with the row\'s kind', () => {
  assert.match(background, /searchAll\(english, await activeJapaneseCatalog\(\), msg\.query, msg\.japanese\)/);
});

test('a Japanese choose row says why it is asking', () => {
  assert.equal(JAPANESE_REASON, 'Looks like a Japanese card. Pick the match.');
  const popup = readFileSync(path.join(root, 'popup.js'), 'utf8');
  assert.match(popup, /<div class="picker-sub">\$\{card\.japanese \? JAPANESE_REASON : candidates\.length \? "Closest matches, best one first" : NO_MATCH_TEXT\}<\/div>/);
  assert.match(popup, /import \{ JAPANESE_REASON \} from "\.\/lib\/why-text\.js"/);
});

test('the popup tells the search which kind of row it is for', () => {
  assert.match(readFileSync(path.join(root, 'popup.js'), 'utf8'), /action: "findCards", query, era: eraSelect\.value \|\| null, japanese: Boolean\(scan\?\.cards\?\.\[idx\]\?\.japanese\)/);
});

test('the manifest asks for tcgcsv.com', () => {
  assert.ok(JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')).host_permissions.includes('https://tcgcsv.com/*'));
});

import { JA_RETRY_MS, createJaLoader, jaRetryAllowed } from '../tools/extension-wasm/lib/japanese.js';

test('jaRetryAllowed: no retry inside the window, a retry at and after it, any time when nothing failed', () => {
  assert.equal(jaRetryAllowed(null, 5), true);
  assert.equal(jaRetryAllowed(1000, 1000), false);
  assert.equal(jaRetryAllowed(1000, 1000 + JA_RETRY_MS - 1), false);
  assert.equal(jaRetryAllowed(1000, 1000 + JA_RETRY_MS), true);
  assert.equal(JA_RETRY_MS, 600000);
});

test('createJaLoader: a failed load is not retried inside the window, then is', async () => {
  let t = 0;
  let calls = 0;
  const run = createJaLoader(async () => { calls++; if (calls === 1) throw new Error('404'); }, () => t);
  await run();
  assert.equal(calls, 1);
  t = JA_RETRY_MS - 1;
  await run();
  await run();
  assert.equal(calls, 1, 'no request inside the window');
  t = JA_RETRY_MS;
  await run();
  assert.equal(calls, 2, 'one retry after it');
});

test('createJaLoader: a failure again restarts the window; callers never see a rejection', async () => {
  let t = 0;
  let calls = 0;
  const run = createJaLoader(async () => { calls++; throw new Error('offline'); }, () => t);
  await run();
  t = JA_RETRY_MS;
  await run();
  assert.equal(calls, 2);
  t = JA_RETRY_MS + 1;
  await run();
  assert.equal(calls, 2);
});

test('createJaLoader: a success is kept for good', async () => {
  let t = 0;
  let calls = 0;
  const run = createJaLoader(async () => { calls++; }, () => t);
  await run();
  t = 100 * JA_RETRY_MS;
  await run();
  await run();
  assert.equal(calls, 1);
});

test('createJaLoader: two concurrent callers share one attempt', async () => {
  let calls = 0;
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const run = createJaLoader(async () => { calls++; await gate; });
  const both = Promise.all([run(), run()]);
  open();
  await both;
  assert.equal(calls, 1);
});

import { clearExamPick, holdExamPick, keepsNoPicture } from '../tools/extension-wasm/lib/correction-save.js';
import { guessOf } from '../tools/extension-wasm/lib/card-picker.js';
import { japaneseStateText } from '../tools/extension-wasm/lib/japanese.js';
import { readFileSync as readSource } from 'node:fs';

test('japaneseRead: the search does not run for a card under the minimum height or with no English score', () => {
  const { ja, vecs } = withVectors();
  let searches = 0;
  const search = (...args) => { searches++; return searchJa(...args); };
  const rule = { auto: true, margin: 0.01, minHeight: 200, search };
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0.2, height: 199 }, rule), null);
  assert.equal(searches, 0);
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0, height: 400 }, rule), null);
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0.2, height: 400 }, { ...rule, auto: false }), null);
  assert.equal(japaneseRead(ja, vecs[1], { bestEn: 0.2, height: NaN }, rule), null);
  assert.equal(searches, 0);
  assert.ok(japaneseRead(ja, vecs[1], { bestEn: 0.2, height: 200 }, rule));
  assert.equal(searches, 1);
});

test('parseJaCatalog: a scale that is not finite or not above 0 is refused', () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const { bytes } = make();
    const copy = new Uint8Array(bytes);
    const view = new DataView(copy.buffer);
    view.setFloat32(4 + view.getUint32(0, true) + 4, bad, true);
    assert.throws(() => parseJaCatalog(copy, EXPECTED), /scale/, String(bad));
  }
});

test('parseJaCatalog: a repeated product id is refused', () => {
  reject({ cards: [CARDS[0], { ...CARDS[1], pid: CARDS[0].pid }] }, /repeats product 709157/);
});

test('a truncated gzip file does not unpack', async () => {
  const gz = gzipSync(make().bytes);
  await assert.rejects(gunzip(gz.subarray(0, gz.length - 12)));
  await assert.rejects(gunzip(gz.subarray(0, 5)));
});

test('a Japanese pick clears an English exam answer held for the same box, and only that box', async () => {
  const saved = [];
  const store = { saveScan: async (scan) => saved.push(scan) };
  const scan = { scanId: 's', shares: { 2: { split: 'exam' } }, examPicks: { 2: { cardId: 'sv1-1', source: 'pick' }, 3: { cardId: 'sv1-2', source: 'pick' } } };
  assert.equal(await clearExamPick(store, scan, { index: 2, pickedId: 'jp-709157' }), true);
  assert.deepEqual(saved[0].examPicks, { 3: { cardId: 'sv1-2', source: 'pick' } });
  assert.equal(saved[0].scanId, 's');
  assert.ok(scan.examPicks[2], 'the stored scan object is not changed in place');
  assert.equal(await clearExamPick(store, scan, { index: 5, pickedId: 'jp-709157' }), false);
  assert.equal(await clearExamPick(store, { scanId: 's' }, { index: 2 }), false);
  assert.equal(await clearExamPick(store, null, { index: 2 }), false);
  assert.equal(saved.length, 1);
  // An English answer still holds, as before.
  const held = [];
  assert.equal(await holdExamPick({ saveScan: async (s) => held.push(s) }, scan, { index: 2, pickedId: 'sv1-9' }, true), true);
  assert.equal(held[0].examPicks[2].cardId, 'sv1-9');
});

test('a pick on a Japanese row, or of a Japanese card, keeps the answer but no picture', () => {
  const flagged = { guess: guessOf({ japanese: true, identity: null, abstain: true }) };
  assert.equal(flagged.guess.japanese, true);
  assert.equal(keepsNoPicture({ ...flagged, pickedId: 'sv1-9' }), true, 'an English pick on a flagged row');
  assert.equal(keepsNoPicture({ ...flagged, pickedId: 'jp-709157' }), true, 'a Japanese pick on a flagged row');
  assert.equal(keepsNoPicture({ guess: guessOf({ abstain: true }), pickedId: 'jp-709157' }), true, 'a Japanese pick on an English row');
  assert.equal(keepsNoPicture({ guess: guessOf({ abstain: true }), pickedId: 'sv1-9' }), false, 'an English pick on an English row keeps its picture');
  assert.equal(keepsNoPicture({ pickedId: 'sv1-9' }), false);
  assert.equal('japanese' in guessOf({ abstain: true }), false);
  const src = readSource(path.join(root, 'background.js'), 'utf8');
  assert.match(src, /crop: keepsNoPicture\(msg\) \? null : correctionSource\(scan, msg\)\.crop/);
  assert.match(src, /await settleExamPick\(_corrections, scan, msg, \{ holdAllowed: examHoldAllowed\(msg\)/);
});

test('the Japanese card list is described in plain words: ready with the count, not available yet, or off', () => {
  assert.equal(japaneseStateText({ state: 'ready', count: 25531 }), 'Ready: 25,531 Japanese cards.');
  assert.equal(japaneseStateText({ state: 'unavailable' }), 'Not available yet. It is tried again later.');
  assert.equal(japaneseStateText({ state: 'off' }), 'Off.');
  assert.equal(japaneseStateText(null), 'Not available yet. It is tried again later.');
  assert.equal(japaneseStateText({ state: 'ready' }), 'Not available yet. It is tried again later.');
  const options = readSource(path.join(root, 'options.js'), 'utf8');
  assert.match(options, /action: "japaneseState"/);
  assert.match(options, /japaneseState\.textContent = japaneseStateText\(info\)/);
  assert.match(readSource(path.join(root, 'options.html'), 'utf8'), /id="japanese-state"/);
  const bg = readSource(path.join(root, 'background.js'), 'utf8');
  assert.match(bg, /japaneseState: async \(\) => \{\s*if \(!\(await japaneseCardsInUse\(\)\)\) return \{ state: "off" \};\s*await _loadJapaneseCatalog\(\);\s*return _ja \? \{ state: "ready", count: _ja\.n \} : \{ state: "unavailable" \};/);
});

import { settleExamPick } from '../tools/extension-wasm/lib/correction-save.js';
import { examRows } from '../tools/extension-wasm/lib/share-rows.js';

test('settleExamPick: an English pick on a Japanese-flagged row of an exam scan holds nothing and clears an earlier answer', async () => {
  const saved = [];
  const store = { saveScan: async (scan) => saved.push(scan) };
  const asked = [];
  const rule = { holdAllowed: true, sharingEnabled: async () => { asked.push(1); return true; } };
  const fresh = () => ({ scanId: 's', shares: { 1: { split: 'exam' } }, examPicks: {} });
  // Nothing held yet: nothing is written, and the English pick is not held either.
  const scan = fresh();
  assert.equal(await settleExamPick(store, scan, { index: 1, pickedId: 'sv1-9', guess: { japanese: true } }, rule), false);
  assert.deepEqual(scan.examPicks, {});
  assert.equal(saved.length, 0);
  assert.equal(asked.length, 0, 'sharing is not even asked about');
  // An English answer held earlier for that box is removed.
  const held = { ...fresh(), examPicks: { 1: { cardId: 'sv1-3', source: 'pick' } } };
  assert.equal(await settleExamPick(store, held, { index: 1, pickedId: 'sv1-9', guess: { japanese: true } }, rule), true);
  assert.deepEqual(saved.at(-1).examPicks, {});
  // A jp- pick on an English row clears too; an English pick on an English row is held as before.
  assert.equal(await settleExamPick(store, held, { index: 1, pickedId: 'jp-709157', guess: {} }, rule), true);
  assert.equal(await settleExamPick(store, fresh(), { index: 1, pickedId: 'sv1-9', guess: {} }, rule), true);
  assert.equal(saved.at(-1).examPicks[1].cardId, 'sv1-9');
  assert.equal(await settleExamPick(store, fresh(), { index: 1, pickedId: 'sv1-9', guess: {} }, { ...rule, holdAllowed: false }), false);
});

test('examRows: a photo with any Japanese box (flagged, shown as jp-, or picked as jp-) sends nothing; other photos are unchanged', () => {
  const shares = [0, 1, 2, 3, 4].map((i) => ({ box: [i, 0, i + 1, 1], scanner: null }));
  const crops = ['c0', 'c1', 'c2', 'c3', 'c4'];
  const known = (id) => !id.startsWith('jp-');
  const base = { shares, crops, known };
  const english = { 0: { index: 0, cardId: 'sv1-1' }, 3: { index: 3, notACard: true }, 4: { index: 4, unknown: true } };
  // Mixed photo: any one Japanese box, of any of the three kinds, makes the whole photo send nothing.
  assert.equal(examRows({ ...base, indices: [0, 1, 3], picks: {}, displayed: { ...english, 1: { index: 1, japanese: true } } }), null);
  assert.equal(examRows({ ...base, indices: [0, 2, 3], picks: {}, displayed: { ...english, 2: { index: 2, cardId: 'jp-709158' } } }), null);
  assert.equal(examRows({ ...base, indices: [0, 3, 4], picks: { 4: { cardId: 'jp-709157', source: 'pick' } }, displayed: english }), null);
  assert.equal(examRows({ ...base, indices: [1, 2], picks: {}, displayed: { 1: { japanese: true }, 2: { cardId: 'jp-1' } } }), null);
  // A photo of only English and not-a-card boxes still gives all its rows, and a held English pick still wins.
  const rows = examRows({ ...base, indices: [0, 3, 4], picks: { 4: { cardId: 'sv1-5', source: 'pick' } }, displayed: english });
  assert.deepEqual(rows.map((r) => r.crop), ['c0', 'c3', 'c4']);
  assert.deepEqual(rows.map((r) => r.answer), [{ cardId: 'sv1-1' }, { notACard: true }, { cardId: 'sv1-5' }]);
});

import { contributeSignal, shareFor, signalRow } from '../tools/extension-wasm/lib/share-rows.js';

test('box rows (drawn, removed, put back) are sent for a Japanese card, with no card id; an English card row is unchanged', async () => {
  const box = [10, 10, 110, 150];
  const japaneseRead = { identity: null, confidence: 0, abstain: true, japanese: true, score: 0.9 };
  const englishRead = { identity: { id: 'sv1-1' }, confidence: 0.9, score: 0.9 };
  const make = (card) => shareFor({ photoId: '0123456789abcdef', box, width: 400, height: 600, card, kind: 'found' });
  // The photo id has to be a teach split for the contribution path; use the share as built and force the split.
  const teach = (card) => ({ ...make(card), split: 'teach' });
  const sent = [];
  const sharing = { enabled: async () => true, contribute: async (payload) => { sent.push(payload); return true; } };
  const send = async (share, source, extra = {}) => {
    sent.length = 0;
    await contributeSignal({
      sharing, msg: { source, index: 0, drawn: true, share, crop: 'data:image/jpeg;base64,AAAA', ...extra }, scan: async () => null, shrink: async () => 'small',
    });
    return sent[0]?.cards?.[0];
  };
  const noCardId = (row) => {
    assert.ok(row, 'the row is sent');
    assert.deepEqual(row.answer, { unknown: true });
    assert.equal(row.scanner.cardId, null);
    assert.ok(!JSON.stringify(row).includes('jp-'));
  };
  for (const source of ['removed', 'put-back', 'drawn']) {
    // (a) flagged Japanese, not picked
    noCardId(await send(teach(japaneseRead), source));
    // (b) flagged with a jp- pick, and (c) flagged with an English pick: the pick never reaches a box row
    for (const pickedId of ['jp-709157', 'sv1-5']) {
      assert.deepEqual(signalRow({ share: teach(japaneseRead), crop: 'c', source, pickedId }).answer, { unknown: true });
      assert.equal(signalRow({ share: teach(japaneseRead), crop: 'c', source, pickedId }).scanner.cardId, null);
    }
    // A share that somehow still holds a jp- guess is blanked as well.
    noCardId(await send({ ...teach(englishRead), scanner: { cardId: 'jp-1', confidence: 0.9, stripe: 'high' } }, source));
  }
  // An English, unflagged card keeps its scanner guess, and a drawn English pick still answers that card.
  const english = teach(englishRead);
  const removed = await send(english, 'removed');
  assert.deepEqual(removed.answer, { unknown: true });
  assert.deepEqual(removed.scanner, { cardId: 'sv1-1', confidence: 0.9, stripe: 'high' });
  assert.deepEqual(signalRow({ share: english, crop: 'c', source: 'drawn', pickedId: 'sv1-5' }).answer, { cardId: 'sv1-5' });
  assert.equal('japanese' in english, false);
});

test('the popup marks a box read as Japanese, shown or hidden, in the answers it confirms', () => {
  const popup = readSource(path.join(root, 'popup.js'), 'utf8');
  assert.match(popup, /if \(card\.japanese \|\| card\.hiddenRead\?\.japanese\) return \{ index, japanese: true \};/);
});
