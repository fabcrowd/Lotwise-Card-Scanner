import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripDevBlocks } from '../scripts/lib/store-package.mjs';

const src = (name) => readFileSync(new URL(`../tools/extension-wasm/${name}`, import.meta.url), 'utf8');
const BANNED = /https?:\/\/(?:localhost|127\.0\.0\.1)|localhost:|testSetCollection|testPhoto|__cardScanner\b|findCardsDiag|importReferences|forceScreenshotPath|dev-only|photoIds|savePhoto|drawn-examples|drawnExample|DrawnExample|drawnPlaced|drawnKind|DRAWN_KINDS/;

// The text of `function name` up to the next top-level declaration.
function body(text, header) {
  const start = text.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  const rest = text.slice(start + header.length);
  const end = rest.search(/\n(?:async function|function|const|let|\/\/ ───|chrome\.|resultsEl\.)/);
  return text.slice(start, start + header.length + (end < 0 ? rest.length : end));
}

const bg = src('background.js');
const popup = src('popup.js');

test('shareBoxSignal is an own-page action only, never a content-script message', () => {
  const actions = bg.slice(bg.indexOf('const _ownPageActions = {'));
  assert.match(actions, /shareBoxSignal: \(msg\) => contributeBoxSignal\(msg\)|shareBoxSignal: async \(msg\)/);
  const listener = bg.slice(0, bg.indexOf('async function handleOverlayRemove'));
  assert.doesNotMatch(listener, /case "shareBoxSignal"/);
  assert.match(bg, /if \(!Object\.hasOwn\(_ownPageActions, msg\.action\)\)/);
});

test('contributeBoxSignal hands contributeSignal the sharing object, the scan lookup and shareCrop, inside its try/catch', () => {
  const fn = body(bg, 'async function contributeBoxSignal(');
  assert.match(fn, /contributeSignal\(\{ sharing: _sharing, scan, msg, shrink: shareCrop \}\)/);
  assert.match(fn, /_corrections\.getScan\(msg\.scanId\)/);
  assert.match(fn, /try \{/);
  assert.match(fn, /catch \(err\)/);
  assert.match(fn, /return \{ ok: true \};\s*\}\s*$/);
});

test('shareCrop never upscales a small picture', () => {
  const fn = body(bg, 'async function shareCrop(');
  assert.match(fn, /cropTooSmall\(bitmap\.width, bitmap\.height\)\) return null/);
});

test('contributeTeachPick sends a drawn pick as a drawn box signal row and a scanned pick as a teach row', () => {
  const fn = body(bg, 'async function contributeTeachPick(');
  assert.match(fn, /msg\.drawn === true/);
  assert.match(fn, /signalRow\(\{ share, crop, source: "drawn", pickedId: msg\.pickedId \}\)/);
  assert.match(fn, /teachRow\(\{ share, crop, pickedId: msg\.pickedId, via: msg\.via \}\)/);
  assert.match(fn, /_sharing\.enabled\(\)/);
  assert.match(fn, /share\.split !== "teach"/);
});

test('readDrawnBox gives the drawn entry a share in the too-small and the read branch, and keeps it through the reshaping', () => {
  const fn = body(bg, 'async function readDrawnBox(');
  assert.match(fn, /photoIdOf\(readBitmap\(photoBitmap\)\)/);
  assert.match(fn, /card, "missed"\)/);
  assert.match(fn, /drawnCardEntry\(\{ box: viewportBox, tooSmall: true, crop: await encodeCrop\(cardCanvas\), share: shareOfDrawn\(null\), \.\.\.place \}\)/);
  assert.match(fn, /drawnCardEntry\(\{ box: viewportBox, read, crop, share: shareOfDrawn\(read\), \.\.\.place \}\)/);
  assert.match(fn, /const \{ rankedScores, \.\.\.rest \} = entry;/);
});

test('found boxes carry the detector score into their share', () => {
  assert.match(bg, /shareOf\(photoId, box, imageW, imageH, \{ \.\.\.read, score \}\)/);
  assert.match(bg, /shareOf\(viewportId, box, bitmap\.width, bitmap\.height, \{ \.\.\.read, score \}\)/);
});

test('the page X with the popup closed sends one removed signal, read before the card is removed', () => {
  const fn = body(bg, 'async function handleOverlayRemove(');
  assert.match(fn, /contributeBoxSignal\(/);
  assert.match(fn, /source: "removed"/);
  assert.match(fn, /scanId: saved\.state\.bgScanId/);
  assert.equal(fn.split('contributeBoxSignal(').length - 1, 1, 'one send per removal, not one per copy of the lot');
  assert.ok(fn.indexOf('const gone = saved?.state?.cards') < fn.indexOf('removeFromLot(saved.state, index)'));
});

test('the popup shares drawn, removed and put-back boxes and never a skip', () => {
  const apply = body(popup, 'function applyDrawnCard(');
  assert.match(apply, /replacedKind\(/);
  assert.match(apply, /withBoxKind\(/);
  assert.match(apply, /sendBoxSignal\("drawn", null, 0, card\)/);
  assert.match(apply, /sendBoxSignal\("drawn", _lastResult\.bgScanId, placed\.index, card\)/);
  assert.match(body(popup, 'function removeAt('), /sendBoxSignal\("removed", _lastResult\?\.bgScanId, idx, card\)/);
  const putBack = body(popup, 'function putBackAt(');
  assert.match(putBack, /if \(removed\) sendBoxSignal\("put-back", scan\.bgScanId, idx, card\);\r?\n {2}else \{/);
  assert.doesNotMatch(body(popup, 'function skipAt('), /shareBoxSignal|sendBoxSignal/);
  const send = body(popup, 'function sendBoxSignal(');
  assert.match(send, /action: "shareBoxSignal"/);
  assert.match(send, /\.catch\(\(\) => \{\}\)/);
  const saveSkip = bg.slice(bg.indexOf('saveSkip: async'), bg.indexOf('unskip:'));
  assert.ok(saveSkip.length > 0);
  assert.doesNotMatch(saveSkip, /contributeBoxSignal|signalRow/);
  assert.match(popup, /const drawnFields = \(card\) => \(card\?\.drawn \? \{ drawn: true, crop: card\.crop \?\? null, share: card\.share \?\? null \} : \{\}\);/);
});

test('the store build still has all of the box signal wiring and none of the banned strings', () => {
  const storeBg = stripDevBlocks(bg, 'background.js');
  const storePopup = stripDevBlocks(popup, 'popup.js');
  for (const text of [
    'contributeBoxSignal', 'contributeSignal(', 'cropTooSmall(', 'signalRow', 'shareBoxSignal: ', '"missed"','source: "removed"',
  ]) assert.ok(storeBg.includes(text), `store background.js lost ${text}`);
  for (const text of ['action: "shareBoxSignal"', 'sendBoxSignal("drawn"', 'sendBoxSignal("removed"', 'sendBoxSignal("put-back"', 'replacedKind', 'withBoxKind']) {
    assert.ok(storePopup.includes(text), `store popup.js lost ${text}`);
  }
  assert.doesNotMatch(storeBg, BANNED);
  assert.doesNotMatch(storePopup, BANNED);
});
