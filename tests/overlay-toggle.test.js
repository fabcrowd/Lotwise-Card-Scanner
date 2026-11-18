import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OVERLAY_SHOWN_KEY, loadOverlayShown, saveOverlayShown, tabMessageFor } from '../tools/extension-wasm/lib/overlay-toggle.js';
import { isSamePage } from '../tools/extension-wasm/lib/draw-box.js';
import { loadPage } from './helpers/fake-page.js';

// "Show boxes on page": a popup toggle that hides the page overlay without clearing the results.

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => { Object.assign(data, items); },
  };
}

test('the overlay is shown by default, and a stored choice survives reopening the popup', async () => {
  const storage = memoryStorage();
  assert.equal(await loadOverlayShown(storage), true);
  await saveOverlayShown(storage, false);
  assert.deepEqual(storage.data, { [OVERLAY_SHOWN_KEY]: false });
  assert.equal(await loadOverlayShown(storage), false, 'read again by a reopened popup');
  await saveOverlayShown(storage, true);
  assert.equal(await loadOverlayShown(storage), true);
  // Anything but a stored false is on.
  assert.equal(await loadOverlayShown(memoryStorage({ [OVERLAY_SHOWN_KEY]: 'yes' })), true);
  assert.equal(await loadOverlayShown({ get: async () => { throw new Error('no storage'); } }), true);
});

test('the background relays the toggle and the overlay\'s shown flag to the tab', () => {
  assert.deepEqual(tabMessageFor({ action: 'setOverlayShown', shown: false }), { action: 'setOverlayShown', shown: false });
  assert.deepEqual(tabMessageFor({ action: 'setOverlayShown', shown: true }), { action: 'setOverlayShown', shown: true });
  const cards = [{ box: [0, 0, 10, 10] }];
  assert.deepEqual(tabMessageFor({ action: 'relayOverlay', cards, srcWidth: 10, srcHeight: 20, shown: false }),
    { action: 'showOverlay', cards, srcWidth: 10, srcHeight: 20, shown: false });
  assert.deepEqual(tabMessageFor({ action: 'relayOverlay', cards, srcWidth: 10, srcHeight: 20, fullSize: { url: 'https://x.example/a.jpg' } }),
    { action: 'showOverlay', cards, srcWidth: 10, srcHeight: 20, fullSize: { url: 'https://x.example/a.jpg' } });
  assert.deepEqual(tabMessageFor({ action: 'relayHighlight', index: 2, scroll: true }), { action: 'highlightCard', index: 2, scroll: true });
  assert.deepEqual(tabMessageFor({ action: 'relayClear' }), { action: 'clearOverlay' });
});

function pageWithCanvas() {
  const page = loadPage();
  let canvas = null;
  page.document.documentElement.appendChild = (node) => { node.isConnected = true; canvas = node; };
  return { page, canvas: () => canvas };
}

const chooseCard = { box: [300, 100, 500, 380], identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 3.1 } } };
const show = (page, extra = {}) => { page.send({ action: 'showOverlay', cards: [chooseCard], srcWidth: 2504, srcHeight: 1287, ...extra }); page.flush(); };

// The Choose chip of chooseCard: "? ~$3.10" in the bottom-right corner, x 423..496, y 354..376 (the fake canvas measures 7 px a character).
function clickTag(page) {
  let prevented = false;
  page.fire('click', { isTrusted: true, clientX: 450, clientY: 365, preventDefault() { prevented = true; }, stopPropagation() {} });
  return prevented;
}

test('turning the boxes off hides the overlay and its tags take no clicks; on again, the same results come back', () => {
  const { page, canvas } = pageWithCanvas();
  show(page);
  assert.equal(page.rec.frames().length, 1);
  assert.equal(canvas().style.visibility, 'visible');

  page.send({ action: 'setOverlayShown', shown: false });
  page.flush();
  assert.equal(canvas().style.visibility, 'hidden');
  assert.equal(page.rec.frames().length, 0);
  assert.equal(clickTag(page), false, 'a hidden tag never takes the page\'s click');

  page.send({ action: 'setOverlayShown', shown: true });
  page.flush();
  assert.equal(canvas().style.visibility, 'visible');
  assert.equal(page.rec.frames().length, 1, 'the results were kept');
  assert.equal(clickTag(page), true);
});

test('a rescan respects the setting: the new overlay, and a restore after a failed scan, stay hidden while off', () => {
  const { page, canvas } = pageWithCanvas();
  show(page);
  page.send({ action: 'setOverlayShown', shown: false });
  page.send({ action: 'hideOverlay' });
  page.flush();
  page.send({ action: 'restoreOverlay' });
  page.flush();
  assert.equal(canvas().style.visibility, 'hidden', 'restore after a failed scan');
  show(page);
  assert.equal(canvas().style.visibility, 'hidden', 'the rescan\'s overlay');
  assert.equal(page.rec.frames().length, 0);
});

test('a fresh page takes the setting from the overlay the popup pushes', () => {
  const { page, canvas } = pageWithCanvas();
  show(page, { shown: false });
  assert.equal(canvas().style.visibility, 'hidden');
  assert.equal(page.rec.frames().length, 0);
  show(page, { shown: true });
  assert.equal(canvas().style.visibility, 'visible');
  assert.equal(page.rec.frames().length, 1);
});

// A lot's overlay is for the page it was scanned on (finding 25). content.js mirrors draw-box.js isSamePage, the rule the
// scanner window uses to decide whether a saved lot belongs to a page; both are fed the same cases so they cannot drift.
const LOT_PAGE = 'https://shop.test/lot/1';
const SAME_PAGE_CASES = [
  [LOT_PAGE, LOT_PAGE],
  [LOT_PAGE, `${LOT_PAGE}#photo-2`],
  [`${LOT_PAGE}#a`, `${LOT_PAGE}#b`],
  [LOT_PAGE, 'https://shop.test/lot/2'],
  [LOT_PAGE, `${LOT_PAGE}?x=1`],
  [LOT_PAGE, 'https://other.test/lot/1'],
  [LOT_PAGE, 'http://shop.test/lot/1'],
];

test('the overlay message carries the lot page and the scan it was drawn from', () => {
  const cards = [{ box: [0, 0, 10, 10] }];
  assert.deepEqual(tabMessageFor({ action: 'relayOverlay', cards, srcWidth: 10, srcHeight: 20, pageUrl: LOT_PAGE, scanId: 'ab12cd34' }),
    { action: 'showOverlay', cards, srcWidth: 10, srcHeight: 20, pageUrl: LOT_PAGE, scanId: 'ab12cd34' });
});

test('an overlay for another page is not drawn, and clears one already shown; the same page (hash ignored) and no page url draw as before', () => {
  // content.js agrees with isSamePage on every pair except a query-only difference, which still counts as the lot's page.
  const queryOnly = (a, b) => { const u = new URL(a); const v = new URL(b); return u.origin === v.origin && u.pathname === v.pathname && u.search !== v.search; };
  for (const [lotUrl, pageUrl] of SAME_PAGE_CASES) {
    const page = loadPage({ url: pageUrl });
    show(page, { pageUrl: lotUrl });
    const expected = isSamePage(lotUrl, pageUrl) || queryOnly(lotUrl, pageUrl);
    assert.equal(page.rec.frames().length === 1, expected, `${lotUrl} on ${pageUrl}`);
  }
  const { page, canvas } = pageWithCanvas();
  page.location.href = LOT_PAGE;
  show(page);
  assert.equal(page.rec.frames().length, 1, 'no page url: drawn as today');
  assert.equal(canvas().isConnected, true);
  page.location.href = 'https://other.test/';
  show(page, { pageUrl: LOT_PAGE });
  assert.equal(canvas().isConnected, false, 'the old overlay is cleared');
  assert.equal(clickTag(page), false, 'and takes no click');
});

test('a query-only change of the page address keeps the lot overlay; another path or origin refuses and clears', () => {
  const { page, canvas } = pageWithCanvas();
  page.location.href = LOT_PAGE;
  show(page, { pageUrl: LOT_PAGE });
  assert.equal(canvas().isConnected, true);
  page.location.href = `${LOT_PAGE}?img=2`;
  show(page, { pageUrl: LOT_PAGE });
  assert.equal(canvas().isConnected, true, 'still drawn after the query changed');
  assert.equal(page.rec.frames().length, 1);
  page.location.href = 'https://shop.test/lot/2';
  show(page, { pageUrl: LOT_PAGE });
  assert.equal(canvas().isConnected, false, 'another path clears');
  page.location.href = LOT_PAGE;
  show(page, { pageUrl: LOT_PAGE });
  assert.equal(canvas().isConnected, true);
  page.location.href = 'https://other.test/lot/1';
  show(page, { pageUrl: LOT_PAGE });
  assert.equal(canvas().isConnected, false, 'another origin clears');
});

test('a draw-mode click on a chip does not also pick the card', () => {
  const page = loadPage();
  show(page);
  page.send({ action: 'startDraw' });
  const stubs = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
  page.fire('click', { isTrusted: true, clientX: 450, clientY: 365, button: 0, ...stubs });
  assert.deepEqual(page.sent.filter((m) => m.action === 'overlayPick' || m.action === 'overlayFullSize'), []);
});

test('an overlay orphaned by an extension reload removes itself and leaves the page its click', () => {
  const { page, canvas } = pageWithCanvas();
  show(page);
  delete page.chrome.runtime.id;
  page.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated'); };
  assert.doesNotThrow(() => assert.equal(clickTag(page), false, 'the click is the page\'s'));
  assert.equal(canvas().isConnected, false, 'the overlay is gone');
  assert.equal(clickTag(page), false, 'listeners are gone');
});

test('a message that cannot be sent leaves the click to the page', () => {
  const page = loadPage();
  show(page);
  page.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated'); };
  assert.doesNotThrow(() => assert.equal(clickTag(page), false));
});

test('overlayRemove carries the scan id the overlay was drawn from', () => {
  const page = loadPage();
  show(page, { cards: [{ box: [300, 100, 372, 200], identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 3 } } }], scanId: 'ab12cd34' });
  page.fire('mousemove', { clientX: 336, clientY: 150 });
  page.flush();
  // The X is centred on the card's top-right corner (372, 100).
  page.fire('click', { isTrusted: true, clientX: 372, clientY: 100, button: 0, preventDefault() {}, stopPropagation() {} });
  const removal = page.sent.find((m) => m.action === 'overlayRemove');
  assert.ok(removal, 'overlayRemove sent');
  assert.equal(removal.scanId, 'ab12cd34');
});

const read = (file) => readFileSync(new URL(`../tools/extension-wasm/${file}`, import.meta.url), 'utf8');

test('the popup has the "Show boxes on page" toggle, on by default, wired to storage and the page', () => {
  const html = read('popup.html');
  assert.match(html, /<label class="overlay-toggle"[^>]*><input type="checkbox" id="overlay-shown" checked> Show boxes on page<\/label>/);
  const popup = read('popup.js');
  assert.match(popup, /loadOverlayShown\(chrome\.storage\.local\)/);
  assert.match(popup, /saveOverlayShown\(chrome\.storage\.local, overlayShownToggle\.checked\)/);
  assert.match(popup, /action: "setOverlayShown", shown: overlayShownToggle\.checked/);
  assert.match(popup, /shown: overlayShownToggle\.checked,/, 'every overlay push carries the setting');
  const background = read('background.js');
  assert.match(background, /"setOverlayShown"/);
  assert.match(background, /tabMessageFor\(msg\)/);
  // The scan's own overlay (a fresh page has no setting yet) carries the stored choice too.
  assert.match(background, /action: "relayOverlay", cards: overlayCards\(cards\), srcWidth, srcHeight, pageUrl: targetTab\.url, scanId, shown: await loadOverlayShown\(chrome\.storage\.local\)/);
});
