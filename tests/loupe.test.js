import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiresUrl, loupeSize, placeLoupe, placeDocked, placeFixed, captionOf, createLoupe, CAPTION_BAND_PX, LOUPE_PAD_PX } from '../tools/extension-wasm/lib/loupe.js';

test('hiresUrl upgrades pokemontcg.io pngs, numeric and lettered numbers', () => {
  assert.equal(hiresUrl('https://images.pokemontcg.io/base1/4.png'), 'https://images.pokemontcg.io/base1/4_hires.png');
  assert.equal(hiresUrl('https://images.pokemontcg.io/sv1/SV001.png'), 'https://images.pokemontcg.io/sv1/SV001_hires.png');
  assert.equal(hiresUrl('https://images.pokemontcg.io/swsh9tg/TG05.png'), 'https://images.pokemontcg.io/swsh9tg/TG05_hires.png');
  assert.equal(hiresUrl('https://images.pokemontcg.io/hgss1/H1.png'), 'https://images.pokemontcg.io/hgss1/H1_hires.png');
});

test('hiresUrl leaves everything else unchanged', () => {
  for (const u of [
    'https://example.com/base1/4.png',
    'http://images.pokemontcg.io/base1/4.png',
    'https://images.pokemontcg.io/base1/4.png?x=1',
    'https://images.pokemontcg.io/base1/4_hires.png',
    'https://images.pokemontcg.io/base1/4.jpg',
    'https://images.pokemontcg.io/base1/sub/4.png',
    'data:image/png;base64,AAAA',
  ]) assert.equal(hiresUrl(u), u);
  assert.equal(hiresUrl(null), null);
  assert.equal(hiresUrl(undefined), null);
  assert.equal(hiresUrl(42), null);
});

test('loupeSize fits 1 and 2 panels', () => {
  assert.deepEqual(loupeSize({ panels: 1, viewport: { w: 500, h: 640 } }),
    { panelW: 321, panelH: 448, totalW: 321, totalH: 448 + CAPTION_BAND_PX });
  assert.deepEqual(loupeSize({ panels: 2, viewport: { w: 500, h: 640 } }),
    { panelW: 226, panelH: 316, totalW: 468, totalH: 316 + CAPTION_BAND_PX });
  assert.deepEqual(loupeSize({ panels: 1, viewport: { w: 900, h: 800 } }),
    { panelW: 329, panelH: 460, totalW: 329, totalH: 500 });
  assert.deepEqual(loupeSize({ panels: 2, viewport: { w: 900, h: 800 } }),
    { panelW: 329, panelH: 460, totalW: 674, totalH: 500 });
  assert.equal(loupeSize({ panels: 1, viewport: { w: 1920, h: 1040 } }).panelH, 460);
  assert.equal(loupeSize({ panels: 2, viewport: { w: 1920, h: 1040 } }).panelH, 460);
});

test('loupeSize honors maxH and survives tiny viewports', () => {
  assert.equal(loupeSize({ panels: 1, viewport: { w: 1920, h: 1040 }, maxH: 300 }).panelH, 300);
  const tiny = loupeSize({ panels: 2, viewport: { w: 100, h: 100 } });
  for (const v of Object.values(tiny)) assert.ok(Number.isFinite(v) && v >= 0);
  const zero = loupeSize({ panels: 2, viewport: { w: 10, h: 0 } });
  assert.equal(zero.panelH, 0);
  assert.equal(zero.panelW, 0);
});

const VP = { w: 800, h: 600 };
const SIZE = { w: 200, h: 300 };

test('placeLoupe prefers right, then left, vertically centered', () => {
  assert.deepEqual(placeLoupe({ anchor: { x: 50, y: 250, w: 60, h: 100 }, size: SIZE, viewport: VP }),
    { x: 118, y: 150, side: 'right' });
  assert.deepEqual(placeLoupe({ anchor: { x: 700, y: 250, w: 60, h: 100 }, size: SIZE, viewport: VP }),
    { x: 492, y: 150, side: 'left' });
});

test('placeLoupe falls back to above or below, centered horizontally', () => {
  const wide = { w: 500, h: 600 };
  const big = { w: 400, h: 200 };
  const above = placeLoupe({ anchor: { x: 100, y: 400, w: 300, h: 100 }, size: big, viewport: wide });
  assert.deepEqual(above, { x: 50, y: 192, side: 'above' });
  const below = placeLoupe({ anchor: { x: 100, y: 50, w: 300, h: 100 }, size: big, viewport: wide });
  assert.deepEqual(below, { x: 50, y: 158, side: 'below' });
});

test('placeLoupe clamps at all four edges', () => {
  const top = placeLoupe({ anchor: { x: 50, y: 0, w: 60, h: 20 }, size: SIZE, viewport: VP });
  assert.equal(top.side, 'right');
  assert.equal(top.y, 8);
  const bottom = placeLoupe({ anchor: { x: 50, y: 580, w: 60, h: 20 }, size: SIZE, viewport: VP });
  assert.equal(bottom.y, 600 - 300 - 8);
  const aboveClamped = placeLoupe({ anchor: { x: 0, y: 590, w: 800, h: 10 }, size: { w: 200, h: 580 }, viewport: VP });
  assert.equal(aboveClamped.side, 'above');
  assert.equal(aboveClamped.y, 8);
  const belowClamped = placeLoupe({ anchor: { x: 0, y: 0, w: 800, h: 30 }, size: { w: 200, h: 570 }, viewport: VP });
  assert.equal(belowClamped.side, 'below');
  assert.equal(belowClamped.y, 600 - 570 - 8);
  const xEdge = placeLoupe({ anchor: { x: 0, y: 200, w: 800, h: 100 }, size: { w: 790, h: 100 }, viewport: VP });
  assert.equal(xEdge.x, 8);
});

test('placeLoupe pins to margin when the box does not fit', () => {
  const r = placeLoupe({ anchor: { x: 100, y: 100, w: 50, h: 50 }, size: { w: 900, h: 700 }, viewport: VP });
  assert.equal(r.x, 8);
  assert.equal(r.y, 8);
});

test('captionOf prefers aria-label, collapses whitespace, truncates', () => {
  const el = (aria, text) => ({ getAttribute: (n) => (n === 'aria-label' ? aria : null), textContent: text });
  assert.equal(captionOf(el('Charizard, Base Set 4', 'ignored')), 'Charizard, Base Set 4');
  assert.equal(captionOf(el(null, '  Pikachu \n\t Base   Set  58 ')), 'Pikachu Base Set 58');
  const long = captionOf(el(null, 'x'.repeat(200)));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
  assert.equal(captionOf(el(null, '')), '');
});

test('createLoupe closes when the hovered tile has no picture', async () => {
  const handlers = {};
  const win = { innerWidth: 500, innerHeight: 680, Image: class {}, addEventListener() {}, removeEventListener() {} };
  const doc = {
    defaultView: win,
    createElement: () => ({ append() {}, set src(v) {}, set alt(v) {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  const root = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  const classes = new Set();
  const loupeEl = {
    hidden: true,
    style: {},
    setAttribute() {},
    replaceChildren() {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
  };
  const makeTile = (src) => ({ src, closest() { return this; }, getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 140 }) });
  const withArt = makeTile('a.png');
  const blank = makeTile(null);
  const lo = createLoupe({
    doc, root, loupeEl, tileSelector: '.t', delayMs: 0,
    compareFor: (t) => (t.src ? { main: { src: t.src, caption: 'x' }, page: null } : null),
  });
  handlers.pointerover({ target: withArt });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(loupeEl.hidden, false);
  handlers.pointerover({ target: blank });
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('createLoupe ignores a detached tile and moves an open preview whose tile was detached to the next tile at once', async () => {
  const handlers = {};
  const win = { innerWidth: 500, innerHeight: 680, Image: class {}, addEventListener() {}, removeEventListener() {} };
  const doc = { defaultView: win, createElement: () => ({ append() {}, set src(v) {}, set alt(v) {} }), addEventListener() {}, removeEventListener() {} };
  const root = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  const loupeEl = { hidden: true, style: {}, setAttribute() {}, replaceChildren() {}, classList: { add() {}, remove() {} } };
  const makeTile = () => ({ isConnected: true, closest() { return this; }, getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 140 }) });
  const lo = createLoupe({ doc, root, loupeEl, tileSelector: '.t', delayMs: 0, compareFor: () => ({ main: { src: 'a.png', caption: '' }, page: null }) });
  const gone = makeTile();
  gone.isConnected = false;
  handlers.pointerover({ target: gone });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(loupeEl.hidden, true);
  const open = makeTile();
  handlers.pointerover({ target: open });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(loupeEl.hidden, false);
  open.isConnected = false;
  handlers.pointerover({ target: makeTile() }); // an open preview moves to the next tile at once, with no new delay
  assert.equal(loupeEl.hidden, false);
  lo.destroy();
});

// Stub DOM for refresh(): elementFromPoint answers from `state.under`; each timer-free step is checked synchronously.
function refreshHarness(extra = {}) {
  const handlers = {};
  const docHandlers = {};
  const state = { under: null, active: null };
  const winHandlers = {};
  const win = { innerWidth: 500, innerHeight: 680, Image: class {}, addEventListener: (type, fn) => { winHandlers[type] = fn; }, removeEventListener() {} };
  const doc = { defaultView: win, createElement: (tag) => ({ tag, children: [], append(...c) { this.children.push(...c); } }), elementFromPoint: () => state.under, get activeElement() { return state.active; }, addEventListener: (type, fn) => { docHandlers[type] = fn; }, removeEventListener() {} };
  const root = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  const loupeEl = {
    hidden: true, style: {}, builds: 0, panels: [], setAttribute() {}, classList: { add() {}, remove() {} },
    replaceChildren(...panels) { this.builds += 1; this.panels = panels; },
    querySelectorAll(sel) { return sel === 'img' ? this.panels.flatMap((p) => p.children.filter((c) => c.tag === 'img')) : []; },
  };
  const makeTile = (src) => ({ src, isConnected: true, rect: { left: 10, top: 10, width: 100, height: 140 }, matches: () => true, closest() { return this; }, getBoundingClientRect() { return this.rect; } });
  const shown = [];
  const lo = createLoupe({
    doc, root, loupeEl, tileSelector: '.t', delayMs: 0,
    compareFor: (t) => { shown.push(t.src); return { main: { src: t.src, caption: '' }, page: null }; },
    ...extra,
  });
  return { handlers, docHandlers, winHandlers, state, loupeEl, makeTile, shown, lo };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('refresh shows the new tile under the pointer at once when the open tile was replaced', async () => {
  const { handlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const old = makeTile('old.png');
  handlers.pointerover({ target: old, clientX: 40, clientY: 50 });
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  old.isConnected = false;
  const fresh = makeTile('new.png');
  state.under = fresh;
  lo.refresh();
  assert.equal(loupeEl.hidden, false);
  assert.equal(shown.at(-1), 'new.png');
  lo.destroy();
});

test('refresh hides an open preview when no tile is under the pointer', async () => {
  const { handlers, state, loupeEl, makeTile, lo } = refreshHarness();
  const old = makeTile('old.png');
  handlers.pointerover({ target: old, clientX: 40, clientY: 50 });
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  old.isConnected = false;
  state.under = { closest: () => null };
  lo.refresh();
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('refresh leaves a closed preview closed', () => {
  const { state, loupeEl, makeTile, shown, lo } = refreshHarness();
  state.under = makeTile('a.png');
  lo.refresh();
  assert.equal(loupeEl.hidden, true);
  assert.deepEqual(shown, []);
  lo.destroy();
});

test('refresh re-aims a pending open at the tile now under the pointer', async () => {
  const { handlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const old = makeTile('old.png');
  handlers.pointerover({ target: old, clientX: 40, clientY: 50 }); // the open timer is pending
  old.isConnected = false;
  const fresh = makeTile('new.png');
  state.under = fresh;
  lo.refresh();
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  assert.deepEqual(shown, ['new.png']);
  lo.destroy();
});

test('a scroll re-aims an open preview at the tile under the pointer, even the same tile, and hides when none is there', async () => {
  const { handlers, docHandlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const tile = makeTile('a.png');
  handlers.pointerover({ target: tile, clientX: 40, clientY: 50 });
  await wait(20);
  assert.deepEqual(shown, ['a.png']);
  state.under = tile;
  docHandlers.scroll({});
  assert.deepEqual(shown, ['a.png', 'a.png']); // re-positioned, not skipped
  const other = makeTile('b.png');
  state.under = other;
  docHandlers.scroll({});
  assert.equal(shown.at(-1), 'b.png');
  assert.equal(loupeEl.hidden, false);
  state.under = { closest: () => null };
  docHandlers.scroll({});
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('a scroll with a focus-opened preview re-aims at the focused tile', async () => {
  const { handlers, docHandlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const tile = makeTile('f.png');
  state.active = tile;
  handlers.focusin({ target: tile });
  await wait(20);
  assert.deepEqual(shown, ['f.png']);
  docHandlers.scroll({});
  assert.deepEqual(shown, ['f.png', 'f.png']);
  assert.equal(loupeEl.hidden, false);
  state.active = null;
  docHandlers.scroll({});
  await wait(120);
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('a focus-opened preview survives refresh with no pointer position and stays on the focused tile', async () => {
  const { handlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const tile = makeTile('f.png');
  state.active = tile;
  handlers.focusin({ target: tile });
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  const fresh = makeTile('f2.png'); // the re-render replaced the tile and focus went to the new one
  tile.isConnected = false;
  state.active = fresh;
  lo.refresh();
  assert.equal(loupeEl.hidden, false);
  assert.equal(shown.at(-1), 'f2.png');
  lo.destroy();
});

test('refresh does not cancel a focus open that is still waiting for its timer', async () => {
  const { handlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const tile = makeTile('f.png');
  state.active = tile;
  handlers.focusin({ target: tile });
  lo.refresh();
  await wait(30);
  assert.equal(loupeEl.hidden, false);
  assert.deepEqual(shown, ['f.png']);
  lo.destroy();
});

test('after a hover and then a focus on another tile, refresh keeps the focused tile', async () => {
  const { handlers, state, loupeEl, makeTile, shown, lo } = refreshHarness();
  const hovered = makeTile('h.png');
  const focused = makeTile('f.png');
  handlers.pointerover({ target: hovered, clientX: 40, clientY: 50 });
  await wait(20);
  state.active = focused;
  handlers.focusin({ target: focused });
  assert.equal(shown.at(-1), 'f.png');
  state.under = hovered; // the stale pointer position still points at the hovered tile
  lo.refresh();
  assert.equal(loupeEl.hidden, false);
  assert.equal(shown.at(-1), 'f.png');
  lo.destroy();
});

test('a scroll with the same tile under the pointer keeps the panels and only moves the preview; a different tile rebuilds them', async () => {
  const { handlers, docHandlers, state, loupeEl, makeTile, lo } = refreshHarness();
  const tile = makeTile('a.png');
  handlers.pointerover({ target: tile, clientX: 40, clientY: 50 });
  await wait(20);
  assert.equal(loupeEl.builds, 1);
  const topBefore = loupeEl.style.top;
  tile.rect = { left: 10, top: 300, width: 100, height: 140 }; // the list scrolled under the pointer
  state.under = tile;
  docHandlers.scroll({});
  assert.equal(loupeEl.builds, 1);
  assert.notEqual(loupeEl.style.top, topBefore);
  const other = makeTile('b.png');
  state.under = other;
  docHandlers.scroll({});
  assert.equal(loupeEl.builds, 2);
  lo.destroy();
});

test('a same-tile scroll that changes the fitted size resizes the kept images to the new panel size', async () => {
  const { handlers, docHandlers, state, loupeEl, makeTile, lo } = refreshHarness();
  const tile = makeTile('a.png');
  tile.rect = { left: 300, right: 400, top: 10, width: 100, height: 140 }; // little room beside it: the preview shrinks
  handlers.pointerover({ target: tile, clientX: 340, clientY: 50 });
  await wait(20);
  const imgs = loupeEl.querySelectorAll('img');
  const before = { w: imgs[0].width, h: imgs[0].height };
  tile.rect = { left: 10, right: 110, top: 10, width: 100, height: 140 }; // scrolled: room on the right, full size
  state.under = tile;
  docHandlers.scroll({});
  assert.equal(loupeEl.builds, 1);
  assert.equal(loupeEl.querySelectorAll('img')[0], imgs[0]);
  assert.notEqual(imgs[0].height, before.h);
  assert.equal(imgs[0].height, parseFloat(loupeEl.style.height) - CAPTION_BAND_PX);
  assert.equal(imgs[0].width, parseFloat(loupeEl.style.width));
  lo.destroy();
});

test('Escape closes the preview and a later refresh or scroll does not reopen it', async () => {
  const { handlers, docHandlers, state, loupeEl, makeTile, lo } = refreshHarness();
  const tile = makeTile('a.png');
  handlers.pointerover({ target: tile, clientX: 40, clientY: 50 });
  await wait(20);
  docHandlers.keydown({ key: 'Escape' });
  assert.equal(loupeEl.hidden, true);
  state.under = tile;
  lo.refresh();
  docHandlers.scroll({});
  await wait(20);
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('a window blur closes the preview', async () => {
  const { handlers, winHandlers, makeTile, loupeEl, lo } = refreshHarness();
  handlers.pointerover({ target: makeTile('a.png'), clientX: 40, clientY: 50 });
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  winHandlers.blur();
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('focus moving from a tile to a control that is not a tile closes the preview after the leave delay', async () => {
  const { handlers, makeTile, loupeEl, lo } = refreshHarness();
  const tile = makeTile('a.png');
  handlers.focusin({ target: tile });
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  handlers.focusout({ target: tile });
  handlers.focusin({ target: { closest: () => null, matches: () => true } });
  assert.equal(loupeEl.hidden, false);
  await wait(150);
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

// 10.2 review dialog: a control that stands for a tile (a pair's checkbox) previews that tile when it takes keyboard focus.
test('10: keyboard focus on a control that stands for a tile previews that tile after the open delay, and closes when focus leaves', async () => {
  const pairTile = { src: 'pair.png' };
  let checkbox;
  const harness = refreshHarness({ focusTile: (el) => (el === checkbox ? harness.tile : null) });
  const { handlers, state, loupeEl, makeTile, shown, lo } = harness;
  harness.tile = makeTile(pairTile.src);
  checkbox = { closest: () => null, matches: (sel) => sel === ':focus-visible' };
  state.active = checkbox;
  handlers.focusin({ target: checkbox });
  await wait(20);
  assert.equal(loupeEl.hidden, false);
  assert.deepEqual(shown, ['pair.png']);
  handlers.focusout({ target: checkbox });
  state.active = null;
  await wait(150);
  assert.equal(loupeEl.hidden, true);
  lo.destroy();
});

test('10: a stand-in control that is not :focus-visible (a mouse press) does not open a preview', async () => {
  let checkbox;
  const harness = refreshHarness({ focusTile: (el) => (el === checkbox ? harness.tile : null) });
  harness.tile = harness.makeTile('pair.png');
  checkbox = { closest: () => null, matches: () => false };
  harness.handlers.focusin({ target: checkbox });
  await wait(20);
  assert.equal(harness.loupeEl.hidden, true);
  harness.lo.destroy();
});

// Drives createLoupe with a stub DOM and returns the loupe box it placed (padding included).
async function placedBox(viewport, tile, panels) {
  const handlers = {};
  const win = { innerWidth: viewport.w, innerHeight: viewport.h, Image: class {}, addEventListener() {}, removeEventListener() {} };
  const doc = { defaultView: win, createElement: () => ({ append() {}, set src(v) {}, set alt(v) {} }), addEventListener() {}, removeEventListener() {} };
  const root = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  const loupeEl = { hidden: true, style: {}, setAttribute() {}, replaceChildren() {}, classList: { add() {}, remove() {} } };
  const rect = { left: tile.x, top: tile.y, right: tile.x + tile.w, bottom: tile.y + tile.h, width: tile.w, height: tile.h };
  const el = { closest() { return this; }, getBoundingClientRect: () => rect };
  const lo = createLoupe({
    doc, root, loupeEl, tileSelector: '.t', delayMs: 0,
    compareFor: () => ({ main: { src: 'a.png', caption: '' }, page: panels === 2 ? { src: 'b.png', caption: '' } : null }),
  });
  handlers.pointerover({ target: el });
  await new Promise((r) => setTimeout(r, 20));
  lo.destroy();
  const w = parseFloat(loupeEl.style.width) + 2 * LOUPE_PAD_PX;
  const h = parseFloat(loupeEl.style.height) + 2 * LOUPE_PAD_PX;
  const x = parseFloat(loupeEl.style.left);
  const y = parseFloat(loupeEl.style.top);
  return { x, y, w, h, style: loupeEl.style, rect };
}

const overlaps = (b, r) => b.x < r.right && b.x + b.w > r.left && b.y < r.bottom && b.y + b.h > r.top;

test('createLoupe shrinks a two-panel preview to sit beside the tile on a wide window', async () => {
  const tile = { x: 640, y: 20, w: 160, h: 230 };
  const b = await placedBox({ w: 1440, h: 900 }, tile, 2);
  assert.equal(overlaps(b, b.rect), false);
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1440 && b.y + b.h <= 900);
  assert.ok(b.x >= b.rect.right, 'sits to the right of the tile');
  assert.equal(b.style.width, '596px'); // two 290 px panels, shrunk from 329 px
  assert.equal(b.style.height, '445px');
  assert.equal(b.style.left, '808px');
});

test('createLoupe stops shrinking at the 200 px panel floor', async () => {
  // Room beside the tile is 440 px here: exactly two 200 px panels plus gap and padding.
  const atFloor = await placedBox({ w: 1000, h: 900 }, { x: 460, y: 300, w: 160, h: 230 }, 2);
  assert.equal(atFloor.style.width, '416px');
  assert.equal(overlaps(atFloor, atFloor.rect), false);
  assert.ok(atFloor.x >= 0 && atFloor.x + atFloor.w <= 1000);
  // 10 px less room: panels would be under 200 px, so the full-size preview and its old placement apply.
  const below = await placedBox({ w: 1000, h: 900 }, { x: 450, y: 300, w: 160, h: 230 }, 2);
  assert.equal(below.style.width, '674px');
  assert.equal(below.style.height, '500px');
  assert.deepEqual([below.style.left, below.style.top], ['151px', '368px']);
});

test('createLoupe at 500x640 keeps the pre-change sizes and placement', async () => {
  const tile = { x: 10, y: 10, w: 100, h: 140 };
  const two = await placedBox({ w: 500, h: 640 }, tile, 2);
  assert.deepEqual({ ...two.style }, { width: '444px', height: '339px', left: '16px', top: '158px' });
  const one = await placedBox({ w: 500, h: 640 }, tile, 1);
  assert.deepEqual({ ...one.style }, { width: '321px', height: '488px', left: '118px', top: '8px' });
});

// ─── Round 3: the compare dock (two-pane) and the fixed spot (narrow) ───

test('placeDocked: right of the left panel, the image top on the dock image top, the same height', () => {
  const p = placeDocked({ dock: { x: 24, y: 210, w: 258, h: 360 }, panelRight: 340, viewport: { w: 1440, h: 900 } });
  assert.deepEqual(p, { x: 348, y: 210 - LOUPE_PAD_PX, panelW: 258, panelH: 360 });
  // The same answer whatever the tile: only the dock decides.
  assert.deepEqual(placeDocked({ dock: { x: 24, y: 210, w: 258, h: 360 }, panelRight: 340, viewport: { w: 1440, h: 900 } }), p);
});

test('placeDocked: shrinks to stay inside a short window and a narrow remainder', () => {
  const short = placeDocked({ dock: { x: 24, y: 100, w: 258, h: 360 }, panelRight: 340, viewport: { w: 1440, h: 400 } });
  assert.ok(short.panelH + CAPTION_BAND_PX + 2 * LOUPE_PAD_PX <= 400 - 16);
  assert.equal(short.panelW, Math.round(short.panelH * 0.716));
  const narrow = placeDocked({ dock: { x: 24, y: 100, w: 258, h: 360 }, panelRight: 340, viewport: { w: 720, h: 900 } });
  assert.ok(narrow.x + narrow.panelW + 2 * LOUPE_PAD_PX <= 720 - 8);
});

test('placeFixed: centered, at the top when the pointer is in the lower half, else at the bottom', () => {
  const size = { w: 444, h: 339 };
  const viewport = { w: 500, h: 760 };
  assert.deepEqual(placeFixed({ size, viewport, pointerY: 600 }), { x: 28, y: 8, side: 'top' });
  assert.deepEqual(placeFixed({ size, viewport, pointerY: 100 }), { x: 28, y: 760 - 339 - 8, side: 'bottom' });
  assert.equal(placeFixed({ size, viewport, pointerY: 380 }).side, 'bottom'); // the middle line counts as the upper half
  assert.deepEqual(placeFixed({ size, viewport, pointerY: 530 }), placeFixed({ size, viewport, pointerY: 700 }));
});

// A stub DOM for the modes: `mode` is what the host answers for a tile.
async function placedWithMode(viewport, tiles, mode, panels = 2) {
  const handlers = {};
  const win = { innerWidth: viewport.w, innerHeight: viewport.h, Image: class {}, addEventListener() {}, removeEventListener() {} };
  const doc = { defaultView: win, createElement: () => ({ append() {}, set src(v) {}, set alt(v) {} }), addEventListener() {}, removeEventListener() {} };
  const root = { addEventListener: (type, fn) => { handlers[type] = fn; }, removeEventListener() {} };
  const loupeEl = { hidden: true, style: {}, setAttribute() {}, replaceChildren(...p) { this.n = p.length; }, classList: { add() {}, remove() {} } };
  const seen = [];
  const lo = createLoupe({
    doc, root, loupeEl, tileSelector: '.t', delayMs: 150, mode, onTile: (t) => seen.push(t),
    compareFor: () => ({ main: { src: 'a.png', caption: '' }, page: panels === 2 ? { src: 'b.png', caption: '' } : null }),
  });
  const out = [];
  for (const t of tiles) {
    const rect = { left: t.x, top: t.y, right: t.x + t.w, bottom: t.y + t.h, width: t.w, height: t.h };
    const el = { closest() { return this; }, getBoundingClientRect: () => rect };
    handlers.pointerover({ target: el, clientX: t.x + 5, clientY: t.y + 5 });
    out.push({ seenNow: seen.length, hiddenNow: loupeEl.hidden });
    await new Promise((r) => setTimeout(r, 200));
    out.push({ left: loupeEl.style.left, top: loupeEl.style.top, w: loupeEl.style.width, h: loupeEl.style.height, panels: loupeEl.n, hidden: loupeEl.hidden });
  }
  lo.destroy();
  return { out, seen };
}

test('createLoupe docked: one panel at the same spot for every tile, and the dock hears about the tile at once', async () => {
  const mode = () => ({ kind: 'docked', dock: { x: 24, y: 210, w: 258, h: 360 }, panelRight: 340 });
  const { out, seen } = await placedWithMode({ w: 1440, h: 900 }, [{ x: 400, y: 100, w: 150, h: 210 }, { x: 900, y: 600, w: 150, h: 210 }], mode);
  assert.equal(seen.length, 2);
  assert.equal(out[0].seenNow, 1, 'the dock is told before the preview delay');
  assert.equal(out[0].hiddenNow, true);
  const [a, b] = [out[1], out[3]];
  assert.deepEqual(a, b);
  assert.equal(a.panels, 1);
  assert.equal(a.left, '348px');
  assert.equal(a.top, `${210 - LOUPE_PAD_PX}px`);
  assert.equal(a.h, `${360 + CAPTION_BAND_PX}px`);
});

test('createLoupe fixed: two panels at the same top or bottom spot, whichever tile in the same half', async () => {
  const mode = () => ({ kind: 'fixed' });
  const { out } = await placedWithMode({ w: 500, h: 760 }, [{ x: 20, y: 500, w: 120, h: 170 }, { x: 300, y: 620, w: 120, h: 170 }, { x: 20, y: 60, w: 120, h: 170 }], mode);
  const [low1, low2, high] = [out[1], out[3], out[5]];
  assert.equal(low1.panels, 2);
  assert.deepEqual(low1, low2);
  assert.equal(low1.top, '8px');
  assert.notEqual(high.top, low1.top);
  assert.equal(high.left, low1.left);
});
