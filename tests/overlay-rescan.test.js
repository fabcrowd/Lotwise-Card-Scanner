import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureWithoutOverlay } from '../tools/extension-wasm/lib/tab-messaging.js';
import { loadPage, makeNode, rectOf } from './helpers/fake-page.js';

// Gate 3 (L2, 11-after-resize-narrow.png): 2 s after narrowing the window the page showed no boxes while the canvas
// held 3 correctly placed ones. The narrow resize had started an automatic "new cards" rescan (O1), and every scan
// hid the overlay before its screenshot until the new result arrived (~37 s).

const L2_SRC = 'https://scontent.fluk1-1.fna.fbcdn.net/v/t39.84726-6/785979793_1059599280168505_4091941950196018489_n.jpg?stp=dst-jpg_p720x720_tt6';
const WIDE = { img: [774.5, 115.95, 844, 633], backdrop: [732.34, 37.61, 928.3, 844.77] };
const NARROW = { img: [392, 264.89, 446.86, 335.14], backdrop: [392, 230, 446.86, 650] };
const AT_SCAN = [[1323, 244, 1566, 558], [1056, 256, 1286, 560], [784, 268, 1028, 563]];
const cards = () => AT_SCAN.map((box, i) => ({ box, identity: { name: `Card ${i}`, number: String(i) }, display: { state: 'identified', price: 1 + i } }));

function l2Page() {
  const timers = [];
  const page = loadPage({ globals: { setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} } });
  let canvas = null;
  page.document.documentElement.appendChild = (node) => { node.isConnected = true; canvas = node; };
  // Facebook's blurred backdrop: the same picture in a matrix(11) container, painted around the photo.
  const back = makeNode('DIV', page.body, { transform: 'matrix(11, 0, 0, 11, 0, 0)', filter: 'blur(2px)' }, rectOf(...WIDE.backdrop));
  const backdrop = page.addImg(back, rectOf(...WIDE.backdrop), { src: L2_SRC, natural: [960, 720] });
  Object.assign(backdrop, { offsetWidth: 84, offsetHeight: 77 });
  const slot = makeNode('DIV', page.body, {}, rectOf(...WIDE.img));
  const img = page.addImg(slot, rectOf(...WIDE.img), { src: L2_SRC, natural: [960, 720] });
  page.stack((x, y) => {
    const r = img.rect;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [img, slot, page.body] : [page.body];
  });
  const layout = (shape) => {
    img.rect = rectOf(...shape.img);
    slot.rect = rectOf(...shape.img);
    backdrop.rect = rectOf(...shape.backdrop);
    back.rect = rectOf(...shape.backdrop);
  };
  // A scan as the background runs it: find the cards, draw them, then watch for pictures loaded later.
  const scan = () => {
    page.send({ action: 'findCards' });
    page.send({ action: 'showOverlay', cards: cards(), srcWidth: 2504, srcHeight: 1287 });
    page.send({ action: 'startObserving' });
    page.flush();
  };
  // The page changed: mutation records reach the observers, then the 500 ms quiet timer runs.
  const settle = () => {
    for (const o of page.observers.mutation) if (o.targets.length) o.callback([{ type: 'childList', target: page.body, addedNodes: [], removedNodes: [] }]);
    while (timers.length) timers.shift()();
    page.flush();
  };
  const newCards = () => page.sent.filter((m) => m.action === 'newCardsDetected').length;
  return { page, img, backdrop, layout, scan, settle, newCards, canvas: () => canvas };
}

function mapped(box, from, to) {
  const sx = to[2] / from[2];
  const sy = to[3] / from[3];
  return [to[0] + (box[0] - from[0]) * sx, to[1] + (box[1] - from[1]) * sy, to[0] + (box[2] - from[0]) * sx, to[1] + (box[3] - from[1]) * sy];
}

function assertShown(page, canvas, expected, label) {
  assert.ok(canvas && canvas.isConnected, `${label}: canvas attached`);
  assert.equal(canvas.style.visibility, 'visible', `${label}: visibility`);
  assert.notEqual(canvas.style.display, 'none', `${label}: display`);
  assert.notEqual(canvas.style.opacity, '0', `${label}: opacity`);
  const drawn = page.rec.frames().map((r) => [r.x1, r.y1, r.x2, r.y2]);
  assert.equal(drawn.length, expected.length, `${label}: ${drawn.length} frames`);
  for (const want of expected) assert.ok(drawn.some((got) => got.every((v, i) => Math.abs(v - want[i]) <= 2)), `${label}: no frame at ${want.map(Math.round)}`);
}

test('(a) after a scan, a window resize that rescales the photo keeps the overlay shown, on the new rect, and starts no rescan', () => {
  const { page, layout, scan, settle, newCards, canvas } = l2Page();
  scan();
  assertShown(page, canvas(), AT_SCAN, 'at scan');
  page.resizeWindow(1428, 986, 1413);
  layout(NARROW);
  page.fire('resize');
  settle();
  assert.equal(newCards(), 0, 'the resize itself is not new cards');
  assertShown(page, canvas(), AT_SCAN.map((b) => mapped(b, WIDE.img, NARROW.img)), 'narrow');
});

test('(b) the same pictures re-laid out by a resize never count as new cards', () => {
  // The backdrop copy of the photo turns card-shaped in the narrow layout; its src was on the page at the scan.
  const backdrop = l2Page();
  backdrop.scan();
  backdrop.page.resizeWindow(1428, 986, 1413);
  backdrop.layout(NARROW);
  backdrop.settle();
  assert.equal(backdrop.newCards(), 0, 'a copy of the scanned photo');

  // A loaded card picture lower on the page comes into view.
  const below = l2Page();
  const tile = below.page.addImg(below.page.body, rectOf(1037, 1400, 250, 350), { src: 'https://scontent.example/tile_n.jpg', natural: [750, 1050] });
  below.scan();
  tile.rect = rectOf(1037, 700, 250, 350);
  below.settle();
  assert.equal(below.newCards(), 0, 'already loaded, only moved into view');

  // A responsive image picks a larger file from the same srcset (currentSrc changes, src and srcset do not).
  const responsive = l2Page();
  const card = responsive.page.addImg(responsive.page.body, rectOf(200, 300, 250, 350), { src: 'https://cdn.example/card-300.jpg', natural: [300, 420] });
  card.attrs.srcset = 'https://cdn.example/card-300.jpg 300w, https://cdn.example/card-900.jpg 900w';
  responsive.scan();
  card.currentSrc = 'https://cdn.example/card-900.jpg';
  responsive.settle();
  assert.equal(responsive.newCards(), 0, 'another size of the same picture');
});

test('(c) a picture that is really new still asks for a rescan: a new image, and a lazy one that finished loading', () => {
  const added = l2Page();
  added.scan();
  added.page.addImg(added.page.body, rectOf(200, 300, 250, 350), { src: 'https://scontent.example/new-card_n.jpg', natural: [750, 1050] });
  added.settle();
  assert.equal(added.newCards(), 1, 'a new image');

  const lazy = l2Page();
  const pending = lazy.page.addImg(lazy.page.body, rectOf(200, 300, 250, 350), { src: 'https://scontent.example/lazy-card_n.jpg', natural: [750, 1050] });
  Object.assign(pending, { complete: false, naturalWidth: 0, naturalHeight: 0 });
  lazy.scan();
  Object.assign(pending, { complete: true, naturalWidth: 750, naturalHeight: 1050 });
  lazy.settle();
  assert.equal(lazy.newCards(), 1, 'a lazy image that loaded after the scan');
  // Once asked, the same picture does not ask again.
  lazy.settle();
  assert.equal(lazy.newCards(), 1);
});

test('(d) a background rescan hides the overlay only for its screenshot; the previous boxes show until the new result', async () => {
  const sent = [];
  const api = { tabs: { sendMessage: async (tabId, msg) => { sent.push(msg.action); return { hidden: true }; } }, scripting: {} };
  const shot = await captureWithoutOverlay(api, 7, async () => { sent.push('capture'); return 'data:image/jpeg;base64,AA'; });
  assert.equal(shot, 'data:image/jpeg;base64,AA');
  assert.deepEqual(sent, ['hideOverlay', 'capture', 'restoreOverlay']);
  sent.length = 0;
  await assert.rejects(captureWithoutOverlay(api, 7, async () => { sent.push('capture'); throw new Error('quota'); }), /quota/);
  assert.deepEqual(sent, ['hideOverlay', 'capture', 'restoreOverlay'], 'shown again when the capture fails');

  // The page side: hidden for the capture, shown again with the same boxes, then replaced by the new result.
  const { page, layout, scan, canvas } = l2Page();
  scan();
  const hidden = page.sendAsync({ action: 'hideOverlay' });
  assert.equal(canvas().style.visibility, 'hidden');
  page.flush();
  assert.equal(JSON.stringify(await hidden), '{"hidden":true}');
  page.send({ action: 'restoreOverlay' });
  page.resizeWindow(1428, 986, 1413);
  layout(NARROW);
  page.fire('resize');
  page.flush();
  assertShown(page, canvas(), AT_SCAN.map((b) => mapped(b, WIDE.img, NARROW.img)), 'during the rescan');
  page.send({ action: 'showOverlay', cards: cards().slice(0, 1), srcWidth: 2504, srcHeight: 1287 });
  page.flush();
  assert.equal(page.rec.frames().length, 1, 'the new result replaces the boxes');

  // Every screenshot in the scanner goes through the helper; no scan hides the overlay any other way.
  const background = readFileSync(new URL('../tools/extension-wasm/background.js', import.meta.url), 'utf8');
  assert.doesNotMatch(background, /action: "hideOverlay"/);
  assert.match(background, /captureWithoutOverlay\(chrome, targetTab\.id, /);
});
