import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, makeNode, rectOf } from './helpers/fake-page.js';

// The overlay follows the photo its boxes came from. Numbers are the measured L2 listing from the 2026-10-25 QA gate
// (.tmp/smoke/2026-10-25-gate1/L2-landscape-lot and L2b-resize-retest): maximised, the photo is 844x633 at
// (774.5, 115.95); in a 1500x1100 window it is 641.86x481.39 at (392, 191.77).

const L2_SRC = 'https://scontent.fluk1-1.fna.fbcdn.net/v/t39.84726-6/785979793_1059599280168505_4091941950196018489_n.jpg?stp=dst-jpg_p720x720_tt6';
const L2_PHOTO2 = 'https://scontent.fluk1-1.fna.fbcdn.net/v/t39.84726-6/790000001_2222222222222222_3333333333333333333_n.jpg?stp=dst-jpg_p720x720_tt6';
const WIDE = { slot: [774.5, 76, 844, 768], wrap: [774.5, 115.95, 844, 636.08], img: [774.5, 115.95, 844, 633] };
const NARROW = { slot: [392, 76, 641.86, 768], wrap: [392, 191.77, 641.86, 484.47], img: [392, 191.77, 641.86, 481.39] };
// The three cased cards as drawn at scan time (canvas px = CSS px).
const AT_SCAN = [[1323, 244, 1566, 558], [1056, 256, 1286, 560], [784, 268, 1028, 563]];

const cards = () => [
  { box: AT_SCAN[0], identity: { name: 'Mega Dragonite ex', number: '271' }, display: { state: 'identified', price: 25.38 } },
  { box: AT_SCAN[1], identity: { name: 'Alakazam ex', number: '201' }, display: { state: 'identified', price: 58.08 } },
  { box: AT_SCAN[2], identity: { name: 'M Gardevoir EX', number: '112' }, display: { state: 'identified', price: 24.09 } },
];

function l2Page() {
  const page = loadPage();
  const slot = makeNode('DIV', page.body, { overflowX: 'hidden', overflowY: 'hidden', position: 'relative' }, rectOf(...WIDE.slot));
  const wrap = makeNode('DIV', slot, {}, rectOf(...WIDE.wrap));
  const img = page.addImg(wrap, rectOf(...WIDE.img), { src: L2_SRC, alt: 'Product photo of POKEMON TCG LISTING' });
  const layout = (shape, dy = 0) => {
    slot.rect = rectOf(shape.slot[0], shape.slot[1] - dy, shape.slot[2], shape.slot[3]);
    wrap.rect = rectOf(shape.wrap[0], shape.wrap[1] - dy, shape.wrap[2], shape.wrap[3]);
    img.rect = rectOf(shape.img[0], shape.img[1] - dy, shape.img[2], shape.img[3]);
  };
  page.stack((x, y) => {
    const r = img.rect;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [img, wrap, slot, page.body] : [page.body];
  });
  return { page, slot, wrap, img, layout };
}

function scanAndShow(page) {
  page.send({ action: 'findCards' });
  page.send({ action: 'showOverlay', cards: cards(), srcWidth: 2504, srcHeight: 1287 });
  page.flush();
}

// Where a box drawn on the photo at scan time belongs on the photo's current rect.
function mapped(box, from, to) {
  const sx = to[2] / from[2];
  const sy = to[3] / from[3];
  return [to[0] + (box[0] - from[0]) * sx, to[1] + (box[1] - from[1]) * sy, to[0] + (box[2] - from[0]) * sx, to[1] + (box[3] - from[1]) * sy];
}

function assertFrames(page, expected, tolerance, label) {
  const drawn = page.rec.frames().map((r) => [r.x1, r.y1, r.x2, r.y2]);
  assert.equal(drawn.length, expected.length, `${label}: ${drawn.length} frames drawn, expected ${expected.length}`);
  for (const want of expected) {
    const hit = drawn.find((got) => got.every((v, i) => Math.abs(v - want[i]) <= tolerance));
    assert.ok(hit, `${label}: no frame within ${tolerance} px of [${want.map((v) => v.toFixed(1))}]; drawn ${JSON.stringify(drawn.map((d) => d.map(Math.round)))}`);
  }
}

test('D1: boxes follow the photo when a window resize rescales it, even when the site lays it out after the resize event', () => {
  const { page, layout } = l2Page();
  scanAndShow(page);
  assertFrames(page, AT_SCAN, 0.01, 'at scan');

  // The resize event fires before the site re-lays out the photo (Facebook sizes it from script a frame later).
  page.resizeWindow(1428, 986, 1413);
  page.fire('resize');
  page.frame();
  layout(NARROW);
  page.flush();
  assertFrames(page, AT_SCAN.map((b) => mapped(b, WIDE.img, NARROW.img)), 2, 'narrow window');

  // Maximised again, then a scroll: back on the cards exactly.
  page.resizeWindow(2504, 1287, 2489);
  page.fire('resize');
  page.frame();
  layout(WIDE);
  page.flush();
  assertFrames(page, AT_SCAN, 0.01, 'maximised again');
  page.window.scrollY = 200;
  layout(WIDE, 200);
  page.fire('scroll');
  page.flush();
  assertFrames(page, AT_SCAN.map((b) => [b[0], b[1] - 200, b[2], b[3] - 200]), 0.01, 'scrolled 200');
  page.window.scrollY = 0;
  layout(WIDE);
  page.fire('scroll');
  page.flush();
  assertFrames(page, AT_SCAN, 0.01, 'scrolled back');
});

test('D1: an overlay pushed again after the window was resized (a price arriving) still lands on the photo', () => {
  const { page, layout } = l2Page();
  scanAndShow(page);
  page.resizeWindow(1428, 986, 1413);
  layout(NARROW);
  page.fire('resize');
  page.flush();
  // The popup re-sends the scan's boxes with the scan's viewport size (2504x1287).
  page.send({ action: 'showOverlay', cards: cards(), srcWidth: 2504, srcHeight: 1287 });
  page.flush();
  assertFrames(page, AT_SCAN.map((b) => mapped(b, WIDE.img, NARROW.img)), 2, 'pushed while narrow');

  page.resizeWindow(2504, 1287, 2489);
  layout(WIDE);
  page.fire('resize');
  page.flush();
  page.window.scrollY = 30;
  layout(WIDE, 30);
  page.fire('scroll');
  page.flush();
  assertFrames(page, AT_SCAN.map((b) => [b[0], b[1] - 30, b[2], b[3] - 30]), 0.01, 'maximised and scrolled');
});

test('D1: the photo rescaled by the page itself (no window event) is followed through a ResizeObserver on it', () => {
  const { page, img, layout } = l2Page();
  scanAndShow(page);
  const watching = page.observers.resize.filter((o) => o.elements.has(img));
  assert.ok(watching.length >= 1, 'the anchored photo is observed for size changes');
  layout(NARROW);
  for (const o of watching) o.callback([{ target: img }]);
  page.flush();
  assertFrames(page, AT_SCAN.map((b) => mapped(b, WIDE.img, NARROW.img)), 2, 'after the page rescaled the photo');
});

function mutate(page, records) {
  for (const o of page.observers.mutation) if (o.targets.length) o.callback(records);
}

test('D2: after the carousel swaps the photo src, the old photo\'s boxes and tags are no longer drawn; back again, they return', () => {
  const { page, img } = l2Page();
  scanAndShow(page);
  assert.equal(page.rec.frames().length, 3);
  assert.ok(page.rec.texts().some((t) => t.includes('Mega Dragonite')));

  img.attrs.src = L2_PHOTO2;
  img.src = L2_PHOTO2;
  img.currentSrc = L2_PHOTO2;
  mutate(page, [{ type: 'attributes', target: img, attributeName: 'src' }]);
  page.flush();
  assert.equal(page.rec.frames().length, 0, 'no frame on the new photo');
  assert.deepEqual(page.rec.texts(), [], 'no tag on the new photo');
  page.fire('scroll');
  page.flush();
  assert.equal(page.rec.frames().length, 0, 'still none after a scroll');

  img.attrs.src = L2_SRC;
  img.src = L2_SRC;
  img.currentSrc = L2_SRC;
  mutate(page, [{ type: 'attributes', target: img, attributeName: 'src' }]);
  page.flush();
  assertFrames(page, AT_SCAN, 0.01, 'photo 1 shown again');
});

test('D2: a larger rendition picked from the same srcset (currentSrc changes, src/srcset do not) keeps the boxes', () => {
  const { page, img } = l2Page();
  img.attrs.srcset = `${L2_SRC} 720w, ${L2_SRC.replace('p720x720', 's2048x2048')} 2048w`;
  scanAndShow(page);
  img.currentSrc = L2_SRC.replace('p720x720', 's2048x2048');
  page.fire('resize');
  page.flush();
  assertFrames(page, AT_SCAN, 0.01, 'after the browser picked a larger rendition');
});

test('D2: a photo element replaced by the carousel (disconnected) draws nothing, without waiting for a scroll', () => {
  const { page, img, wrap } = l2Page();
  scanAndShow(page);
  img.isConnected = false;
  page.addImg(wrap, rectOf(...WIDE.img), { src: L2_PHOTO2 });
  mutate(page, [{ type: 'childList', target: wrap, addedNodes: [], removedNodes: [img] }]);
  page.flush();
  assert.equal(page.rec.frames().length, 0);
  assert.deepEqual(page.rec.texts(), []);
});

test('D10: nothing is drawn over a fixed site header that covers the top of the photo', () => {
  const { page, img, wrap, slot, layout } = l2Page();
  const header = makeNode('DIV', page.body, { position: 'fixed' }, rectOf(0, 0, 2489, 56));
  const icon = makeNode('DIV', header, {}, rectOf(1200, 8, 40, 40));
  page.stack((x, y) => {
    if (y < 56) return [icon, header, page.body];
    const r = img.rect;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [img, wrap, slot, page.body] : [page.body];
  });
  scanAndShow(page);
  page.window.scrollY = 200;
  layout(WIDE, 200);
  page.fire('scroll');
  page.flush();
  // The top card (y 44..358 now) is still partly in view below the header.
  assert.ok(page.rec.frames().length >= 1, 'cards below the header are still drawn');
  for (const op of page.rec.visible()) {
    assert.ok(op.seen.y1 >= 56 - 0.01, `${op.kind}${op.text ? ` "${op.text}"` : ''} drawn at y ${op.seen.y1.toFixed(1)}, over the header (bottom 56)`);
  }
  // Hovering the top card opens its full label below the header, not under it.
  page.fire('mousemove', { clientX: 1400, clientY: 120 });
  page.flush();
  // The full label's name line has no number; the small tag's title does.
  assert.ok(page.rec.texts().includes('Mega Dragonite ex'), 'the hovered card\'s label is drawn');
  for (const op of page.rec.visible()) {
    assert.ok(op.seen.y1 >= 56 - 0.01, `hover: ${op.kind}${op.text ? ` "${op.text}"` : ''} drawn at y ${op.seen.y1.toFixed(1)}, over the header`);
  }
  // Hovering the header itself opens nothing.
  page.fire('mousemove', { clientX: 1400, clientY: 50 });
  page.flush();
  assert.ok(!page.rec.texts().includes('Mega Dragonite ex'), 'no full label from a point on the header');
});

// D15 (gate 2, L1 at scroll 200): a top-row card whose box is still 158 px visible below the 56 px header lost its
// tag. The real L1 boxes (gate 2 L1/iou-pairs.json) and texts (L1/_10a.png); the canvas measures text at 8 px a
// character, near the bold 13-16 px tag font. The box's own top spots are under the header and its inside bottom is
// taken by the overlapping neighbour's tag, so before the fix the tag fell below the box, onto the next row.
const L1_PHOTO = [908.5, 74.47, 576, 768];
const L1_CARDS = [
  ['Pikachu', 'SM157', [908, 141, 1102, 416], '$1.43–$33.03'],
  ['Detective Pikachu', '10', [1023, 134, 1280, 414], '$1.01–$6.34'],
  ['Pikachu', '30', [1304, 174, 1447, 412], '$2.64–$16.01'],
  ['Pikachu', '65', [933, 433, 1104, 641], '$0.80–$33.03'],
  ['Raichu', '056', [1118, 432, 1276, 641], 0.22],
  ['Pikachu', '19', [1295, 419, 1435, 629], '$1.01–$6.34'],
  ['Alolan Raichu', '57', [962, 649, 1114, 828], '$7.17–$8.81'],
  ['Gengar', '050', [1113, 651, 1264, 834], '$0.47–$117.99'],
  ['Gengar', 'SWSH241', [1285, 627, 1416, 824], '$8.21–$117.99'],
];

test('D15: every card still visible under a fixed header keeps its tag, inside the visible part of its box', () => {
  const page = loadPage();
  page.rec.ctx.measureText = (t) => ({ width: String(t).length * 8 });
  const slot = makeNode('DIV', page.body, {}, rectOf(...L1_PHOTO));
  const img = page.addImg(slot, rectOf(...L1_PHOTO), { src: 'https://scontent.example/800186390_n.jpg', natural: [1537, 2048] });
  const header = makeNode('DIV', page.body, { position: 'fixed' }, rectOf(0, 0, 2489, 56));
  page.stack((x, y) => {
    if (y < 56) return [header, page.body];
    const r = img.rect;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? [img, slot, page.body] : [page.body];
  });
  page.send({ action: 'findCards' });
  const cards = L1_CARDS.map(([name, number, box, price]) => (typeof price === 'number'
    ? { box, identity: { name, number }, display: { state: 'identified', number, price } }
    : { box, identity: { name, number }, display: { state: 'printing', number, printingNote: `set not sure · ${price}` } }));
  page.send({ action: 'showOverlay', cards, srcWidth: 2504, srcHeight: 1287 });
  page.flush();
  page.window.scrollY = 200;
  for (const el of [slot, img]) el.rect = rectOf(L1_PHOTO[0], L1_PHOTO[1] - 200, L1_PHOTO[2], L1_PHOTO[3]);
  page.fire('scroll');
  page.flush();
  for (const [name, number, box] of L1_CARDS) {
    const [x1, y1, x2, y2] = [box[0], box[1] - 200, box[2], box[3] - 200];
    const title = `${name} #${number}`;
    // A card's tag starts at its box's left edge (kept on the photo): accent 4 + padding 7 + 2.
    const textX = Math.max(x1, L1_PHOTO[0]) + 13;
    const tag = page.rec.ops.find((o) => o.kind === 'text' && o.seen && o.text.startsWith(name) && Math.abs(o.seen.x1 - textX) <= 1);
    assert.ok(tag, `${title}: no tag while its box shows y ${Math.max(56, y1)}..${y2}`);
    assert.ok(tag.seen.y1 >= 56 && tag.seen.y1 === tag.rect.y1, `${title}: tag under the header at ${JSON.stringify(tag.seen)}`);
    // A card whose top is under the header gets its tag inside the part of the box that shows.
    if (y1 < 56) assert.ok(tag.seen.y2 <= y2 && tag.seen.x1 >= x1 && tag.seen.x1 < x2, `${title}: tag at ${JSON.stringify(tag.seen)}, box shows ${x1},56..${x2},${y2}`);
  }
});

test('D10: a box is clipped to the photo inside an overflow-hidden slot', () => {
  const { page, slot } = l2Page();
  slot.rect = rectOf(774.5, 300, 844, 200);
  scanAndShow(page);
  for (const op of page.rec.visible()) {
    assert.ok(op.seen.y1 >= 300 - 0.01 && op.seen.y2 <= 500 + 0.01, `${op.kind} drawn at y ${op.seen.y1.toFixed(1)}..${op.seen.y2.toFixed(1)}, outside the slot 300..500`);
  }
});
