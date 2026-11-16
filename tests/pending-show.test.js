import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PENDING_SHOW_KEY, PENDING_SHOW_MAX_AGE_MS, clearPendingShow, matchPendingFullSize, matchPendingShow, savePendingFullSize, savePendingShow, takePendingShow } from '../tools/extension-wasm/lib/pending-show.js';

// A click on a page card opens the scanner at that card. A window opened by the click reads the card's index once its
// lot is restored; an index left over from an earlier click is ignored.

const PAGE = 'https://shop.example/lot/1';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => { Object.assign(data, items); },
    remove: async (key) => { delete data[key]; },
  };
}

test('a saved index is taken once, then gone', async () => {
  const storage = memoryStorage();
  await savePendingShow(storage, { index: 3, url: PAGE }, 1000);
  assert.deepEqual(storage.data[PENDING_SHOW_KEY], { index: 3, url: PAGE, at: 1000 });
  assert.deepEqual(await takePendingShow(storage, 1000 + 500), { index: 3, url: PAGE });
  assert.equal(PENDING_SHOW_KEY in storage.data, false, 'cleared once used');
  assert.equal(await takePendingShow(storage, 1000 + 600), null, 'not delivered twice');
});

test('an index older than 10 s is ignored and cleared; one at the limit still counts', async () => {
  assert.equal(PENDING_SHOW_MAX_AGE_MS, 10_000);
  const stale = memoryStorage();
  await savePendingShow(stale, { index: 2, url: PAGE }, 0);
  assert.equal(await takePendingShow(stale, PENDING_SHOW_MAX_AGE_MS + 1), null);
  assert.equal(PENDING_SHOW_KEY in stale.data, false, 'a stale index is cleared too');
  const edge = memoryStorage();
  await savePendingShow(edge, { index: 2, url: PAGE }, 0);
  assert.deepEqual(await takePendingShow(edge, PENDING_SHOW_MAX_AGE_MS), { index: 2, url: PAGE });
});

test('nothing stored, a malformed value, or unreadable storage gives null', async () => {
  assert.equal(await takePendingShow(memoryStorage(), 0), null);
  for (const bad of [{ index: -1, url: PAGE, at: 0 }, { index: 1.5, url: PAGE, at: 0 }, { index: 'a', url: PAGE, at: 0 }, { index: 1, url: PAGE }, { index: 1, at: 0 }, { index: 1, url: 5, at: 0 }, 'x', null]) {
    assert.equal(await takePendingShow(memoryStorage({ [PENDING_SHOW_KEY]: bad }), 1), null, JSON.stringify(bad));
  }
  assert.equal(await takePendingShow({ get: async () => { throw new Error('no storage'); }, remove: async () => {} }, 0), null);
});

// 10.2 full-size pill with the scanner window closed: the same record, with a kind beside the card-index kind.
test('a full-size record carries its kind, is taken once, and goes stale like an index', async () => {
  const storage = memoryStorage();
  await savePendingFullSize(storage, { url: PAGE }, 1000);
  assert.deepEqual(storage.data[PENDING_SHOW_KEY], { kind: 'fullsize', url: PAGE, at: 1000 });
  assert.deepEqual(await takePendingShow(storage, 1500), { kind: 'fullsize', url: PAGE });
  assert.equal(PENDING_SHOW_KEY in storage.data, false, 'cleared once used');
  const stale = memoryStorage();
  await savePendingFullSize(stale, { url: PAGE }, 0);
  assert.equal(await takePendingShow(stale, PENDING_SHOW_MAX_AGE_MS + 1), null);
  for (const bad of [{ kind: 'fullsize', at: 0 }, { kind: 'fullsize', url: 5, at: 0 }, { kind: 'fullsize', url: PAGE }, { kind: 'other', url: PAGE, at: 0 }]) {
    assert.equal(await takePendingShow(memoryStorage({ [PENDING_SHOW_KEY]: bad }), 1), null, JSON.stringify(bad));
  }
});

test('a full-size record is never a card index, and a card record is never a full-size one', async () => {
  const lot = `${PAGE}#photo-2`;
  assert.equal(matchPendingShow({ kind: 'fullsize', url: lot }, PAGE), null, 'no index to show');
  assert.equal(matchPendingFullSize({ kind: 'fullsize', url: lot }, PAGE), true);
  assert.equal(matchPendingFullSize({ kind: 'fullsize', url: lot }, 'https://shop.example/lot/2'), false, 'another page');
  assert.equal(matchPendingFullSize({ kind: 'fullsize', url: lot }, null), false);
  assert.equal(matchPendingFullSize({ index: 4, url: PAGE }, PAGE), false);
  assert.equal(matchPendingFullSize(null, PAGE), false);
  assert.equal(await takePendingShow(memoryStorage({ [PENDING_SHOW_KEY]: { index: 2, url: PAGE, at: 0 } }), 5).then((p) => p.kind), undefined, 'the card kind has no kind field');
});

test('a pending index is shown only for the page of the lot the window holds; a hash is ignored, anything else is discarded', () => {
  const pending = { index: 4, url: `${PAGE}#photo-2` };
  assert.equal(matchPendingShow(pending, PAGE), 4);
  assert.equal(matchPendingShow(pending, 'https://shop.example/lot/2'), null, 'another page');
  assert.equal(matchPendingShow(pending, null), null, 'no lot to show it in');
  assert.equal(matchPendingShow(null, PAGE), null);
});

// background.js and popup.js cannot be imported in a test, so their wiring is pinned in source.
const src = (name) => readFileSync(new URL(`../tools/extension-wasm/${name}`, import.meta.url), 'utf8');

test('the toolbar button and a page-card click share one open-or-focus function; windows.create appears once', () => {
  const bg = src('background.js');
  assert.equal((bg.match(/windows\.create\(/g) || []).length, 0, 'the window is opened in lib/scanner-window.js only');
  assert.equal((src('lib/scanner-window.js').match(/windows\.create\(/g) || []).length, 1, 'one place opens the scanner window');
  assert.match(bg, /createScannerOpener\(\{[^]{0,200}windows: chrome\.windows/);
  assert.match(bg, /const openOrFocusScanner = /);
  assert.match(bg, /chrome\.action\.onClicked\.addListener\([^)]*\)\s*=>\s*\{[\s\S]{0,400}openOrFocusScanner\(/);
  assert.match(bg, /case "overlayPick":[\s\S]{0,900}openOrFocusScanner\(/);
});

test('the background stores the index and page only from the open hook, and sends nothing to a window that is already open', () => {
  const bg = src('background.js');
  assert.match(bg, /case "overlayPick":[\s\S]{0,900}acceptPageSender\(/, 'only a page\'s content script');
  assert.match(bg, /case "overlayPick":[\s\S]{0,900}openOrFocusScanner\(sender\.tab, \(\) => savePendingShow\(chrome\.storage\.session, \{ index: msg\.index, url: sender\.tab\.url \}\), \(\) => clearPendingShow\(chrome\.storage\.session\)\)/);
  assert.equal((bg.match(/savePendingShow\(/g) || []).length, 1, 'stored from the hook only: a focus-only call stores nothing');
  assert.doesNotMatch(bg, /sendMessage\(\{ action: "overlayPick"/, 'the open popup already got the page\'s message; no second delivery');
});

test('the popup picks up a pending index once, after its lot is restored', () => {
  const popup = src('popup.js');
  assert.match(popup, /takePendingShow\(chrome\.storage\.session/);
  // Taken when the window starts (the 10 s age check must not wait for a scan), applied after recoverLot() restores the lot.
  const init = popup.slice(popup.lastIndexOf('(async () => {'));
  assert.ok(init.indexOf('takePendingShow(chrome.storage.session)') >= 0 && init.indexOf('takePendingShow(chrome.storage.session)') < init.indexOf('await recoverLot()'), 'taken before recoverLot');
  assert.ok(init.indexOf('await recoverLot()') < init.indexOf('matchPendingShow(held, _lotUrl)'), 'applied after the lot is restored');
});

test('the popup takes overlayPick only from the background or from a page\'s content script, and never relays it on', () => {
  const popup = src('popup.js');
  // Anchored on its own check: other listeners with the same signature (hover, full-size, draw) may come before it.
  const listener = popup.slice(popup.search(/chrome\.runtime\.onMessage\.addListener\(\(msg, sender\) => \{\s*if \(msg\?\.action !== "overlayPick"/));
  assert.match(listener, /^[^]{0,200}overlayPick[^]{0,400}acceptPickSender\(sender, chrome\.runtime\.id, _lotUrl\)/);
  assert.match(listener, /^[^]{0,900}showCardInScanner\(msg\.index\);[^]{0,300}takePendingShow\(chrome\.storage\.session\)/, 'a window that showed the card uses up the stored index');
  assert.doesNotMatch(popup, /sendMessage\(\{ action: "overlayPick"/);
});

test('clearPendingShow removes a stored record, and does not throw when storage fails', async () => {
  const storage = memoryStorage();
  await savePendingShow(storage, { index: 1, url: PAGE }, 0);
  await clearPendingShow(storage);
  assert.equal(PENDING_SHOW_KEY in storage.data, false);
  await clearPendingShow({ remove: async () => { throw new Error('no storage'); } });
});

test('a record taken when the window starts is still applied after a restore that takes longer than 10 s', async () => {
  const storage = memoryStorage();
  await savePendingShow(storage, { index: 2, url: PAGE }, 1000);
  const held = await takePendingShow(storage, 1000 + 500); // init time
  assert.equal(matchPendingShow(held, PAGE), 2, 'applied at restore time, 60 s later, without another age check');
});
