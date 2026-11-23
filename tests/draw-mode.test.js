import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, rectOf } from './helpers/fake-page.js';

const HINT = 'Drag a box around the card. Esc to cancel.';
const NOT_PHOTO = 'Draw over a photo.';

// A listing page with one 600x400 photo at (100, 80).
function page() {
  const p = loadPage({ viewport: { w: 1200, h: 800 }, clientWidth: 1200 });
  p.addImg(p.body, rectOf(100, 80, 600, 400), { src: 'https://shop.test/lot.jpg', natural: [1800, 1200] });
  const made = [];
  const create = p.document.createElement;
  p.document.createElement = (tag) => { const el = create(tag); made.push(el); return el; };
  return { ...p, made };
}

const stubs = () => { const calls = { prevent: 0, stop: 0 }; return { calls, preventDefault() { calls.prevent++; }, stopPropagation() { calls.stop++; }, stopImmediatePropagation() { calls.stop++; } }; };
const mouse = (p, type, x, y) => { const s = stubs(); p.fire(type, { clientX: x, clientY: y, button: 0, ...s }); return s.calls; };
const drag = (p, x1, y1, x2, y2) => { mouse(p, 'mousedown', x1, y1); mouse(p, 'mousemove', (x1 + x2) / 2, (y1 + y2) / 2); mouse(p, 'mousemove', x2, y2); mouse(p, 'mouseup', x2, y2); };
const key = (p, k) => p.fire('keydown', { key: k, ...stubs() });
const drawn = (p) => p.sent.filter((m) => m.action === 'drawnBox');
// content.js runs in its own vm realm, so what it returns is compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const live = (p) => p.made.filter((el) => el.isConnected);

test('the draw hint and a crosshair veil appear on startDraw and nothing is sent yet', () => {
  const p = page();
  assert.deepEqual(plain(p.send({ action: 'startDraw' })), { ok: true });
  assert.ok(live(p).some((el) => el.textContent === HINT), 'hint bar');
  assert.ok(live(p).some((el) => el.style.cursor === 'crosshair'), 'crosshair');
  assert.equal(drawn(p).length, 0);
});

test('a drag over the photo sends its element data and the drawn viewport rect, then leaves draw mode', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  drag(p, 150, 120, 300, 340);
  const [msg] = drawn(p);
  assert.ok(msg, 'drawnBox sent');
  assert.deepEqual(plain(msg.drawn), [150, 120, 300, 340]);
  assert.equal(msg.photo.src, 'https://shop.test/lot.jpg');
  assert.deepEqual([msg.photo.rect.x, msg.photo.rect.y, msg.photo.rect.w, msg.photo.rect.h], [100, 80, 600, 400]);
  assert.deepEqual([msg.photo.naturalWidth, msg.photo.naturalHeight], [1800, 1200]);
  assert.equal(msg.photo.render.fit, 'fill');
  assert.equal(msg.viewportWidth, 1200);
  assert.equal(msg.viewportHeight, 800);
  assert.equal(msg.devicePixelRatio, 1);
  assert.ok(msg.page && Array.isArray(msg.page.ogImages));
  assert.equal(live(p).length, 0, 'every element it added is gone');
});

test('the scroll position rides along so the box can be placed in the document', () => {
  const p = page();
  p.window.scrollY = 250;
  p.send({ action: 'startDraw' });
  drag(p, 150, 120, 300, 340);
  assert.equal(drawn(p)[0].scrollY, 250);
  assert.equal(drawn(p)[0].scrollX, 0);
});

test('dragging in any direction gives the same ordered rectangle', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  drag(p, 300, 340, 150, 120);
  assert.deepEqual(plain(drawn(p)[0].drawn), [150, 120, 300, 340]);
});

test('one box per activation: a second drag sends nothing and the page sees its own clicks', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  drag(p, 150, 120, 300, 340);
  drag(p, 150, 120, 300, 340);
  assert.equal(drawn(p).length, 1);
  const outside = mouse(p, 'mousedown', 200, 200);
  assert.equal(outside.stop, 0);
  assert.equal(outside.prevent, 0);
  const click = mouse(p, 'click', 200, 200);
  assert.equal(click.stop, 0);
  assert.equal(click.prevent, 0);
});

test('Esc cancels and removes everything', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  key(p, 'Escape');
  assert.equal(live(p).length, 0);
  drag(p, 150, 120, 300, 340);
  assert.equal(drawn(p).length, 0);
});

// 10.2: a plain click no longer cancels; it keeps draw mode and says what to do. The hint bar has a Cancel button.
const CLICK_HINT = 'Drag a box around the card.';
const cancelButton = (p) => live(p).find((el) => el.tagName === 'BUTTON' && el.textContent === 'Cancel');
const ended = (p) => p.sent.filter((m) => m.action === 'drawEnded');

test('a click without a drag keeps draw mode and the hint says to drag a box', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  mouse(p, 'mousedown', 200, 200);
  mouse(p, 'mouseup', 200, 200);
  assert.ok(live(p).length > 0, 'still in draw mode');
  assert.ok(live(p).some((el) => el.textContent === CLICK_HINT), 'the hint now says to drag');
  assert.equal(drawn(p).length, 0);
  assert.equal(ended(p).length, 0);
  drag(p, 150, 120, 300, 340);
  assert.equal(drawn(p).length, 1, 'a drag after the click still draws');
});

test('the hint bar has a Cancel button that leaves draw mode and tells the scanner window', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  const button = cancelButton(p);
  assert.ok(button, 'a Cancel button is in the hint bar');
  const down = stubs();
  p.fire('mousedown', { clientX: 5, clientY: 5, button: 0, target: button, ...down });
  assert.equal(drawn(p).length, 0);
  assert.ok(live(p).length > 0, 'pressing it does not start a rectangle or leave yet');
  p.fire('mouseup', { clientX: 5, clientY: 5, button: 0, target: button, ...stubs() });
  p.fire('click', { clientX: 5, clientY: 5, button: 0, target: button, ...stubs() });
  assert.equal(live(p).length, 0, 'everything it added is gone');
  assert.equal(ended(p).length, 1);
});

test('Esc tells the scanner window draw mode ended; a finished drag and a cancel from the window do not', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  key(p, 'Escape');
  assert.equal(ended(p).length, 1);
  const q = page();
  q.send({ action: 'startDraw' });
  drag(q, 150, 120, 300, 340);
  assert.equal(ended(q).length, 0, 'a drawn box is its own answer');
  const r = page();
  r.send({ action: 'startDraw' });
  r.send({ action: 'cancelDraw' });
  assert.equal(ended(r).length, 0, 'the window asked for it and knows');
});

test('a box under 12x12 is ignored and draw mode stays on', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  drag(p, 200, 200, 210, 330); // 10 wide
  drag(p, 200, 200, 330, 211); // 11 tall
  assert.equal(drawn(p).length, 0);
  assert.ok(live(p).length > 0);
  drag(p, 200, 200, 212, 212); // exactly 12x12 on the photo
  assert.equal(drawn(p).length, 1);
});

test('a box not mostly over one photo says so and stays in draw mode', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  drag(p, 800, 100, 1000, 300); // beside the photo
  assert.equal(drawn(p).length, 0);
  assert.ok(live(p).some((el) => el.textContent === NOT_PHOTO));
  drag(p, 150, 120, 300, 340);
  assert.equal(drawn(p).length, 1);
});

test('the draw mode events are swallowed so the page does not react, and only while on', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  const down = mouse(p, 'mousedown', 200, 200);
  assert.ok(down.prevent > 0 && down.stop > 0);
  const click = mouse(p, 'click', 200, 200);
  assert.ok(click.stop > 0);
  key(p, 'Escape');
  const after = mouse(p, 'mousedown', 200, 200);
  assert.equal(after.stop, 0);
});

test('startDraw twice does not stack listeners or elements', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  const first = live(p).length;
  p.send({ action: 'startDraw' });
  assert.equal(live(p).length, first);
  drag(p, 150, 120, 300, 340);
  assert.equal(drawn(p).length, 1);
});

test('cancelDraw from the extension also leaves draw mode', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  p.send({ action: 'cancelDraw' });
  assert.equal(live(p).length, 0);
});

// The acceptance rule on its own.
const pure = () => loadPage().window.__cardScanner.pure;
const photoAt = (x, y, w, h) => ({ src: `s${x}`, rect: { x, y, w, h, vx: x, vy: y, vw: w, vh: h } });

test('pickDrawTarget needs at least half of the drawn area over one visible photo', () => {
  const { pickDrawTarget } = pure();
  const photos = [photoAt(0, 0, 100, 100)];
  assert.equal(pickDrawTarget([0, 0, 100, 100], photos)?.src, 's0');
  assert.equal(pickDrawTarget([50, 0, 150, 100], photos)?.src, 's0'); // exactly half
  assert.equal(pickDrawTarget([51, 0, 151, 100], photos), null);
  assert.equal(pickDrawTarget([300, 300, 400, 400], photos), null);
  assert.equal(pickDrawTarget([0, 0, 100, 100], []), null);
});

test('pickDrawTarget uses only the visible part of a photo and takes the largest overlap', () => {
  const { pickDrawTarget } = pure();
  const clipped = { src: 'clipped', rect: { x: 0, y: 0, w: 100, h: 100, vx: 0, vy: 0, vw: 100, vh: 20 } };
  assert.equal(pickDrawTarget([0, 0, 100, 100], [clipped]), null);
  const a = photoAt(0, 0, 100, 100);
  const b = { ...photoAt(60, 0, 100, 100), src: 'b' };
  assert.equal(pickDrawTarget([40, 0, 140, 100], [a, b])?.src, 'b');
});

// Draw mode must not outlive the page it was started on.
test('pagehide and beforeunload leave draw mode', () => {
  for (const type of ['pagehide', 'beforeunload']) {
    const p = page();
    p.send({ action: 'startDraw' });
    p.fire(type);
    assert.equal(live(p).length, 0, type);
    assert.equal(mouse(p, 'mousedown', 200, 200).stop, 0, `${type}: listeners gone`);
  }
});

test('the page going hidden leaves draw mode; becoming visible does not', () => {
  const p = page();
  p.send({ action: 'startDraw' });
  p.document.visibilityState = 'visible';
  p.fire('visibilitychange');
  assert.ok(live(p).length > 0);
  p.document.visibilityState = 'hidden';
  p.fire('visibilitychange');
  assert.equal(live(p).length, 0);
  p.document.visibilityState = 'visible';
  p.send({ action: 'startDraw' });
  assert.ok(live(p).length > 0, 'a later startDraw works again');
  p.document.visibilityState = 'hidden';
  p.fire('visibilitychange');
  p.fire('pagehide');
  assert.equal(live(p).length, 0);
});
