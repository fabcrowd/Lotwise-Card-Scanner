import assert from 'node:assert/strict';
import test from 'node:test';
import { imageToViewportTransform } from '../tools/extension-wasm/photo-detection.js';
import { loadPage, rectOf } from './helpers/fake-page.js';

// Hover labels on the page (D4 of the 2026-10-25 QA gate): a card under 140 px wide showed only its price.

test('D4: hovering a 128 px card on the page opens a label with its name and price', () => {
  const page = loadPage();
  const card = { box: [300, 100, 428, 275], identity: { name: 'Drowzee', number: '61' }, display: { state: 'identified', price: 0.07 } };
  page.send({ action: 'showOverlay', cards: [card], srcWidth: 2504, srcHeight: 1287 });
  page.flush();
  page.fire('mousemove', { clientX: 360, clientY: 200 });
  page.flush();
  const texts = page.rec.texts();
  assert.ok(texts.includes('Drowzee'), JSON.stringify(texts));
  assert.ok(texts.includes('$0.07'), JSON.stringify(texts));
});

test('D4: hovering a Choose card in a 139 px box names the guess', () => {
  const page = loadPage();
  const card = { box: [300, 100, 439, 290], identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 3.1 } } };
  page.send({ action: 'showOverlay', cards: [card], srcWidth: 2504, srcHeight: 1287 });
  page.flush();
  page.fire('mousemove', { clientX: 360, clientY: 200 });
  page.flush();
  assert.ok(page.rec.texts().some((t) => t.startsWith('Entei?')), JSON.stringify(page.rec.texts()));
});

// D13 (gate 2, E1b eBay photo 4): an object-fit: contain photo 1126x1502 in an 876x630 <img> paints a 472.29x630
// picture at +201.85; the rest is letterbox. The hover label ran 41 px past the picture into it.
const E1B = { x: 100, y: 100, w: 876, h: 630, natural: [1126, 1502] };
const PICTURE = { x1: E1B.x + 201.85, x2: E1B.x + 201.85 + 472.29, y1: E1B.y, y2: E1B.y + 630 };

test('D13: the hover label stays inside the painted picture of an object-fit: contain photo, not the <img> box', () => {
  const page = loadPage();
  const img = page.addImg(page.body, rectOf(E1B.x, E1B.y, E1B.w, E1B.h), { src: 'https://i.ebayimg.com/images/g/x/s-l1600.webp', natural: E1B.natural });
  img.style.objectFit = 'contain';
  page.stack((x, y) => (x >= E1B.x && x <= E1B.x + E1B.w && y >= E1B.y && y <= E1B.y + E1B.h ? [img, page.body] : [page.body]));
  page.send({ action: 'findCards' });
  // Entei: a 133x182 box whose right edge is 22 px inside the picture's right edge.
  const box = [PICTURE.x2 - 22 - 133, 300, PICTURE.x2 - 22, 482];
  const card = { box, identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 0.26 } } };
  page.send({ action: 'showOverlay', cards: [card], srcWidth: 2504, srcHeight: 1287 });
  page.flush();
  page.fire('mousemove', { clientX: box[0] + 60, clientY: 400 });
  page.flush();
  const label = page.rec.ops.filter((o) => o.kind === 'text' && /^(Entei\?|Tap to pick)/.test(o.text));
  assert.equal(label.length, 2, JSON.stringify(page.rec.texts()));
  for (const op of label) {
    assert.ok(op.rect.x1 >= PICTURE.x1 - 0.01 && op.rect.x2 <= PICTURE.x2 + 0.01, `"${op.text}" at x ${op.rect.x1.toFixed(1)}..${op.rect.x2.toFixed(1)}, picture ${PICTURE.x1.toFixed(1)}..${PICTURE.x2.toFixed(1)}`);
  }
  // Nothing at all is drawn in the letterbox.
  for (const op of page.rec.visible()) {
    assert.ok(op.seen.x1 >= PICTURE.x1 - 0.01 && op.seen.x2 <= PICTURE.x2 + 0.01, `${op.kind}${op.text ? ` "${op.text}"` : ''} in the letterbox at x ${op.seen.x1.toFixed(1)}..${op.seen.x2.toFixed(1)}`);
  }
});

test('the painted picture of an <img> is placed as photo-detection.js places it, for every object-fit and position', () => {
  const pure = loadPage().window.__cardScanner.pure;
  const rect = { x: 40, y: 60, w: 876, h: 630 };
  for (const natural of [[1126, 1502], [1600, 1200], [300, 200], [2000, 500]]) {
    for (const fit of ['fill', 'contain', 'cover', 'none', 'scale-down']) {
      for (const position of ['50% 50%', 'left top', 'right bottom', '25% 75%', 'top', 'right', 'bottom left', 'center']) {
        const t = imageToViewportTransform(rect, natural[0], natural[1], { fit, position });
        const want = [t.left, t.top, t.left + natural[0] * t.scaleX, t.top + natural[1] * t.scaleY];
        const got = pure.paintedBox(rectOf(rect.x, rect.y, rect.w, rect.h), natural[0], natural[1], fit, position);
        assert.deepEqual([got.left, got.top, got.right, got.bottom].map((v) => +v.toFixed(6)), want.map((v) => +v.toFixed(6)), `${natural} ${fit} ${position}`);
      }
    }
  }
  assert.equal(pure.paintedBox(rectOf(0, 0, 10, 10), 0, 0, 'contain', '50% 50%'), null, 'not loaded');
  assert.equal(pure.paintedBox(rectOf(0, 0, 10, 10), 5, 5, 'contain', 'calc(10px)'), null, 'a position it cannot read');
});
