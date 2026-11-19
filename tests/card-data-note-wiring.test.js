import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (name) => readFileSync(new URL(`../tools/extension-wasm/${name}`, import.meta.url), 'utf8');
const bg = src('background.js');
const popup = src('popup.js');
const html = src('popup.html');

function body(text, header) {
  const start = text.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  const rest = text.slice(start + header.length);
  const end = rest.search(/\n(?:async function|function|const|let|\/\/ ───|chrome\.|\/\/ At most one)/);
  return text.slice(start, start + header.length + (end < 0 ? rest.length : end));
}

test('applyBundleOnce stores the next card data note, only when a bundle is stored, and never fails the apply', () => {
  const fn = body(bg, 'async function applyBundleOnce(');
  assert.match(fn, /nextCardDataNote\(prev, \{ seq: stored\?\.manifest\?\.seq, cards: merged\?\.meta, now: Date\.now\(\) \}\)/);
  assert.match(fn, /if \(stored\) \{/, 'nothing is touched when no bundle is stored');
  assert.match(fn, /CARD_DATA_NOTE_KEY/);
  // the note step runs after the swap and inside its own try/catch
  assert.ok(fn.indexOf('nextCardDataNote(') > fn.indexOf('_photoCheck = pickCheck('));
  assert.match(fn, /try \{[\s\S]*nextCardDataNote[\s\S]*\} catch \(err\) \{\s*console\.error\(/);
});

test('the dismiss runs on the same chain as applyBundle, so it never interleaves with a new note being stored', () => {
  const start = bg.indexOf('case "cardDataNoteDismiss":');
  assert.ok(start >= 0);
  const handler = bg.slice(start, bg.indexOf('return true;', start));
  assert.match(handler, /_applying = _applying\.then\(/);
  assert.match(handler, /dismissedNote\(/);
  assert.match(handler, /sendResponse\(\{ ok: true \}\)/);
  assert.match(handler, /catch \{\s*sendResponse\(\{ ok: false \}\);/, 'a failed dismiss must not leave the shared chain rejected');
  assert.match(bg, /^let _applying = Promise\.resolve\(\);/m);
});

test('cardDataNote and cardDataNoteDismiss are own-page messages', () => {
  const set = bg.slice(bg.indexOf('const OWN_PAGE_ONLY = new Set(['), bg.indexOf(']);', bg.indexOf('const OWN_PAGE_ONLY')));
  assert.match(set, /"cardDataNote"/);
  assert.match(set, /"cardDataNoteDismiss"/);
  assert.match(bg, /OWN_PAGE_ONLY\.has\(msg\.action\) && !isOwnPage\(/);
  assert.match(bg, /case "cardDataNote":/);
  assert.match(bg, /case "cardDataNoteDismiss":/);
  assert.match(bg, /dismissedNote\(/);
});

test('the scanner window has a hidden carddata notice and asks for the note', () => {
  assert.match(html, /<div class="access-notice" id="carddata-notice" hidden>/);
  assert.match(html, /id="carddata-text" role="status"/);
  assert.match(html, /id="carddata-ok"[^>]*>OK</);
  assert.match(popup, /action: "cardDataNote"/);
  assert.match(popup, /action: "cardDataNoteDismiss"/);
  assert.match(popup, /cardDataNoteText\(/);
  assert.match(popup, /carddataText\.textContent = /);
});
