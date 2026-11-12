import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OVERLAY_SHOWN_KEY, loadOverlayShown, saveOverlayShown, tabMessageFor } from '../tools/extension-wasm/lib/overlay-toggle.js';
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

function clickTag(page) {
  let prevented = false;
  page.fire('click', { isTrusted: true, clientX: 310, clientY: 110, preventDefault() { prevented = true; }, stopPropagation() {} });
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
  assert.match(background, /action: "relayOverlay", cards: overlayCards\(cards\), srcWidth, srcHeight, shown: await loadOverlayShown\(chrome\.storage\.local\)/);
});
