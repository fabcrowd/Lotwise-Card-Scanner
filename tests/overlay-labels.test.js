import assert from 'node:assert/strict';
import test from 'node:test';
import { imageToViewportTransform } from '../tools/extension-wasm/photo-detection.js';
import { loadPage, makeNode, rectOf } from './helpers/fake-page.js';

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

// The resting overlay: corner brackets and a price chip in the bottom-right corner; the name only on hover.
// The fake canvas measures 7 px a character, so "$0.07" is 35 px and its chip 17 + 35 = 52 px wide.
const REST = { box: [300, 100, 428, 275], identity: { name: 'Drowzee', number: '61' }, display: { state: 'identified', price: 0.07 } };
const showCards = (page, cards) => { page.send({ action: 'showOverlay', cards, srcWidth: 2504, srcHeight: 1287 }); page.flush(); };

test('at rest a card shows brackets and a price chip in its bottom-right corner, and no name', () => {
  const page = loadPage();
  showCards(page, [REST]);
  assert.deepEqual(page.rec.texts(), ['$0.07']);
  const text = page.rec.ops.find((o) => o.kind === 'text');
  // The chip is 4 px in from the card's right and bottom edges: x 372..424, y 249..271; its text starts after the rail and padding.
  assert.equal(text.rect.x1, 372 + 10);
  assert.ok(text.rect.y1 >= 249 && text.rect.y1 <= 271, `text at y ${text.rect.y1}`);
  const slab = page.rec.ops.find((o) => o.kind === 'fill' && o.rect.x1 === 372 && o.rect.x2 === 424 && o.rect.y1 === 249 && o.rect.y2 === 271);
  assert.ok(slab, 'the chip slab is drawn 22 px tall at the corner');
  assert.equal(page.rec.frames().length, 1);
});

test('hovering a card adds its name card above it; the chip stays', () => {
  const page = loadPage();
  showCards(page, [REST]);
  page.fire('mousemove', { clientX: 360, clientY: 200 });
  page.flush();
  const texts = page.rec.texts();
  assert.ok(texts.includes('Drowzee') && texts.includes(' #61'), JSON.stringify(texts));
  assert.equal(texts.filter((t) => t === '$0.07').length, 2, 'the chip and the name card both say the price');
  const name = page.rec.ops.find((o) => o.kind === 'text' && o.text === 'Drowzee');
  assert.ok(name.rect.y1 + 15 <= 100, `the name is above the card's top edge (y 100), at ${name.rect.y1}`);
});

test('a small card shows a dot instead of a chip that does not fit, and a skipped card shows nothing', () => {
  const page = loadPage();
  const small = { box: [300, 100, 370, 200], identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 3.1 } } };
  showCards(page, [small, { box: [500, 100, 600, 240], identity: { name: 'Skipped one' }, display: { state: 'skipped' } }]);
  assert.deepEqual(page.rec.texts(), []);
  assert.ok(page.rec.ops.some((o) => o.kind === 'fill' && o.rect.x1 === 356 && o.rect.y1 === 186 && o.rect.x2 === 366 && o.rect.y2 === 196), 'a 10 px dot in the bottom-right corner');
});

test('a Choose chip takes a click on the chip and the padded 28 px around it, and nothing else on the card', () => {
  const page = loadPage();
  const choose = { box: [300, 100, 500, 380], identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 3.1 } } };
  showCards(page, [choose]);
  const click = (x, y) => {
    let prevented = false;
    page.fire('click', { isTrusted: true, clientX: x, clientY: y, preventDefault() { prevented = true; }, stopPropagation() {} });
    return prevented;
  };
  // The chip: x 423..496, y 354..376; its click area is 28 px tall, y 351..379.
  assert.equal(click(450, 365), true);
  assert.deepEqual(JSON.parse(JSON.stringify(page.sent.at(-1))), { action: 'overlayPick', index: 0 });
  assert.equal(click(450, 352), true, 'the padding above the chip');
  assert.equal(click(450, 340), false, 'above the click area');
  // Where the old two-line tag sat (top-left of the card) is the page\'s again.
  assert.equal(click(310, 110), false);
  // An identified chip is not clickable until its card is hovered (8.5 below).
  showCards(page, [REST]);
  assert.equal(click(400, 260), false);
});

// Crowded grids through showOverlay: a binder page photo of 3x3 and of 5x5 small cards.
const KINDS = [
  { identity: { name: 'Pikachu', number: '10' }, display: { state: 'identified', number: '10', price: 3.49 } },
  { identity: { name: 'Charizard', number: '11' }, display: { state: 'printing', number: '11', printingNote: 'set not sure · $0.60–$12.01' } },
  { identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 0.74 } } },
  { identity: null, abstain: true, display: { state: 'choose' } },
  { identity: { name: 'Mewtwo', number: '14' }, display: { state: 'identified', number: '14', price: 120, highValue: true } },
  { identity: null, abstain: true, cardBack: true, display: { state: 'none' } },
  { identity: { name: 'Gengar' }, display: { state: 'skipped' } },
];

function gridPage(cols, rows, cw, ch, gap) {
  const page = loadPage();
  const at = { x: 100, y: 50 };
  const w = cols * cw + (cols + 1) * gap;
  const h = rows * ch + (rows + 1) * gap;
  const photo = { x1: at.x, y1: at.y, x2: at.x + w, y2: at.y + h };
  const img = page.addImg(page.body, rectOf(at.x, at.y, w, h), { src: 'https://photos.example/binder.jpg' });
  page.stack((x, y) => (x >= photo.x1 && x <= photo.x2 && y >= photo.y1 && y <= photo.y2 ? [img, page.body] : [page.body]));
  page.send({ action: 'findCards' });
  const cards = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = at.x + gap + c * (cw + gap);
      const y = at.y + gap + r * (ch + gap);
      cards.push({ box: [x, y, x + cw, y + ch], ...KINDS[(r * cols + c) % KINDS.length] });
    }
  }
  showCards(page, cards);
  return { page, photo, cards };
}

// A chip slab is a 22 px tall fill wider than its 3 px rail; a dot is a 10 px square fill.
const chipRects = (page) => page.rec.ops
  .filter((o) => o.kind === 'fill' && ((o.rect.y2 - o.rect.y1 === 22 && o.rect.x2 - o.rect.x1 > 3) || (o.rect.x2 - o.rect.x1 === 10 && o.rect.y2 - o.rect.y1 === 10)))
  .map((o) => o.rect);

for (const [name, grid] of [['3x3 grid', [3, 3, 190, 266, 16]], ['5x5 grid of 70 px cards', [5, 5, 70, 98, 8]]]) {
  test(`${name}: no two chips or dots overlap, and every one lies inside the visible photo`, () => {
    const { page, photo, cards } = gridPage(...grid);
    const rects = chipRects(page);
    const skipped = cards.filter((c) => c.display.state === 'skipped').length;
    assert.equal(rects.length, cards.length - skipped, 'every card but the skipped ones keeps a chip or a dot');
    rects.forEach((a, i) => {
      assert.ok(a.x1 >= photo.x1 && a.y1 >= photo.y1 && a.x2 <= photo.x2 && a.y2 <= photo.y2, `chip ${i} outside the photo: ${JSON.stringify(a)}`);
      rects.forEach((b, j) => assert.ok(i === j || !(a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2), `chips ${i} and ${j} overlap`));
    });
    if (grid[2] === 70) assert.ok(rects.some((r) => r.x2 - r.x1 === 10), 'dots appear on small cards');
  });
}

test('the X wins a click over a wide name card that overlaps it; the name card still takes a click elsewhere', () => {
  const page = loadPage();
  const card = { box: [300, 100, 372, 200], identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Team Rocket\'s Moltres ex', price: 3 } } };
  showCards(page, [card]);
  page.fire('mousemove', { clientX: 336, clientY: 150 });
  page.flush();
  const name = page.rec.ops.find((o) => o.kind === 'text' && o.text.startsWith('Team Rocket'));
  assert.ok(name && name.rect.x2 > 381, 'the name card is wider than the card and runs under the X');
  const click = (x, y) => {
    let prevented = false;
    page.fire('click', { isTrusted: true, clientX: x, clientY: y, preventDefault() { prevented = true; }, stopPropagation() {} });
    return prevented;
  };
  // The X is centred on (372, 100): its circle spans y 91..109; the name card above ends at y 96. (372, 93) is on both.
  assert.equal(click(372, 93), true);
  assert.deepEqual(JSON.parse(JSON.stringify(page.sent.at(-1))), { action: 'overlayRemove', index: 0 });
  assert.equal(click(320, 70), true);
  assert.deepEqual(JSON.parse(JSON.stringify(page.sent.at(-1))), { action: 'overlayPick', index: 0 });
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
  const label = page.rec.ops.filter((o) => o.kind === 'text' && /^(Entei\?|Click to pick)/.test(o.text));
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

// 8.5: clicking the highlighted (hovered) card opens it in the scanner, in every state.
function clickAt(page, x, y, extra = {}) {
  let prevented = false;
  let stopped = false;
  page.fire('click', { isTrusted: true, clientX: x, clientY: y, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...extra });
  return { prevented, stopped };
}
const lastSent = (page) => JSON.parse(JSON.stringify(page.sent.at(-1)));
const hover = (page, x, y) => { page.fire('mousemove', { clientX: x, clientY: y }); page.flush(); };

test('8.5: a primary click on the hovered identified card sends overlayPick and is stopped', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  const before = page.sent.length;
  assert.deepEqual(clickAt(page, 320, 150), { prevented: true, stopped: true });
  assert.equal(page.sent.length, before + 1);
  assert.deepEqual(lastSent(page), { action: 'overlayPick', index: 0 });
});

test('8.5: the hovered name card of an identified card takes the click too', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  const name = page.rec.ops.find((o) => o.kind === 'text' && o.text === 'Drowzee');
  const r = clickAt(page, name.rect.x1 + 2, name.rect.y1 + 2);
  assert.equal(r.prevented, true);
  assert.deepEqual(lastSent(page), { action: 'overlayPick', index: 0 });
});

test('8.5: a click with Ctrl, Shift, Alt or Meta, or with another button, passes through and sends nothing', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  const before = page.sent.length;
  for (const extra of [{ ctrlKey: true }, { shiftKey: true }, { altKey: true }, { metaKey: true }, { button: 1 }, { button: 2 }]) {
    assert.deepEqual(clickAt(page, 320, 150, extra), { prevented: false, stopped: false }, JSON.stringify(extra));
  }
  assert.equal(page.sent.length, before);
});

test('8.5: a click on a card that is not hovered is not taken', () => {
  const page = loadPage();
  showCards(page, [REST]);
  assert.equal(clickAt(page, 320, 150).prevented, false);
  assert.equal(page.sent.length, 0);
});

test('8.5: a click while the overlay is hidden passes through', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  page.send({ action: 'setOverlayShown', shown: false });
  page.flush();
  assert.equal(clickAt(page, 320, 150).prevented, false);
});

test('8.5: an untrusted click on the hovered card is not taken', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  assert.equal(clickAt(page, 320, 150, { isTrusted: false }).prevented, false);
});

test('8.5: the X on a hovered identified card still removes it, and wins over the card box', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  assert.equal(clickAt(page, 428, 100).prevented, true);
  assert.deepEqual(lastSent(page), { action: 'overlayRemove', index: 0 });
});

// 8.5 review: site UI painted over a card (a menu, a sticky bar) takes its own click; the box hit area only counts
// where the card's photo is the topmost element there.
function anchoredPage() {
  const page = loadPage();
  const img = page.addImg(page.body, rectOf(100, 50, 800, 600), { src: 'https://photos.example/a.jpg' });
  const menu = page.addImg(page.body, rectOf(1500, 60, 300, 200), { src: 'https://site.example/menu.png' });
  menu.textContent = 'Account menu'; // site UI has text of its own (a text-free layer is not site UI)
  const state = { stack: [img, page.body] };
  page.stack(() => state.stack);
  page.send({ action: 'findCards' });
  showCards(page, [REST]);
  return { page, img, menu, state };
}

test('8.5 review: a click on the card where the photo is topmost is taken', () => {
  const { page } = anchoredPage();
  hover(page, 360, 200);
  assert.equal(clickAt(page, 320, 150).prevented, true);
  assert.deepEqual(lastSent(page), { action: 'overlayPick', index: 0 });
});

test('8.5 review: site UI over the card passes the click through and does not show the card as hovered', () => {
  const { page, menu, state } = anchoredPage();
  hover(page, 360, 200);
  const before = page.sent.length;
  state.stack = [menu, page.body];
  assert.deepEqual(clickAt(page, 320, 150), { prevented: false, stopped: false });
  assert.equal(page.sent.length, before);
  // Hover with the menu on top: the name card goes away.
  hover(page, 361, 201);
  assert.equal(page.rec.texts().includes(' #61'), false, JSON.stringify(page.rec.texts()));
});

test('final review: the X on a hovered card wins the click even with site UI over it (photoOnTop gates only the box)', () => {
  const { page, menu, state } = anchoredPage();
  hover(page, 360, 200);
  const before = page.sent.length;
  state.stack = [menu, page.body];
  assert.deepEqual(clickAt(page, 428, 100), { prevented: true, stopped: true });
  assert.equal(page.sent.length, before + 1);
  assert.deepEqual(lastSent(page), { action: 'overlayRemove', index: 0 });
  // The same click on the box (not the X) still passes through to the site UI.
  assert.equal(clickAt(page, 320, 150).prevented, false);
});

test('final review: the X wins over the hovered name card and the chip drawn under it', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  const close = page.rec.ops.find((o) => o.kind === 'text' && o.text === '×') || null;
  const point = close ? { x: close.rect.x1 + 3, y: close.rect.y1 + 8 } : { x: 428, y: 100 };
  assert.equal(clickAt(page, point.x, point.y).prevented, true);
  assert.deepEqual(lastSent(page), { action: 'overlayRemove', index: 0 });
});

test('final review: a new overlay sends its first hover again, even for the card index the last overlay ended on', () => {
  const page = loadPage({ globals: { clearTimeout, setTimeout } });
  const hovers = () => page.sent.filter((m) => m.action === 'overlayHover').map((m) => m.index);
  showCards(page, [REST]);
  hover(page, 360, 200);
  assert.deepEqual(hovers().filter((i) => i === 0).length, 1);
  page.send({ action: 'clearOverlay' });
  showCards(page, [REST]);
  hover(page, 360, 200);
  assert.equal(hovers().filter((i) => i === 0).length, 2, JSON.stringify(hovers()));
});

test('8.5 review: an element inside the photo\'s own container still counts as the photo', () => {
  const { page, img, state } = anchoredPage();
  hover(page, 360, 200);
  state.stack = [page.body, img];
  assert.equal(clickAt(page, 320, 150).prevented, true, 'an ancestor of the photo on top (the page body) is not site UI over it');
});

// What counts as site UI over a card: an unrelated element that is interactive or has text of its own. A transparent,
// text-free layer (a zoom or lightbox hit area, a carousel layer, an empty link) belongs to the photo.
const layerOf = (page, tag, extra = {}) => makeNode(tag, page.body, {}, rectOf(100, 50, 800, 600), { textContent: '', ...extra });

test('8.5 review: a transparent text-free sibling layer over the photo still hovers and takes the click', () => {
  const { page, state } = anchoredPage();
  state.stack = [layerOf(page, 'DIV'), page.body];
  hover(page, 360, 200);
  assert.ok(page.rec.texts().includes(' #61'), 'hovered through the layer');
  assert.equal(clickAt(page, 320, 150).prevented, true);
  assert.deepEqual(lastSent(page), { action: 'overlayPick', index: 0 });
});

test('8.5 review: a text-free link over the photo is the photo\'s layer; a link with text is site UI', () => {
  const { page, state } = anchoredPage();
  state.stack = [layerOf(page, 'A', { attrs: { href: '/item/1' } }), page.body];
  hover(page, 360, 200);
  assert.equal(clickAt(page, 320, 150).prevented, true);
  state.stack = [layerOf(page, 'A', { attrs: { href: '/item/1' }, textContent: 'See details' }), page.body];
  const before = page.sent.length;
  assert.equal(clickAt(page, 320, 150).prevented, false);
  assert.equal(page.sent.length, before);
});

test('8.5 review: a photo inside a shadow root is clicked through its host', () => {
  const page = loadPage();
  const host = makeNode('DIV', page.body, {}, rectOf(100, 50, 800, 600), { textContent: '' });
  const img = page.addImg(null, rectOf(100, 50, 800, 600), { src: 'https://photos.example/shadow.jpg' });
  img.getRootNode = () => ({ host });
  page.stack(() => [host, page.body]);
  page.send({ action: 'findCards' });
  showCards(page, [REST]);
  hover(page, 360, 200);
  assert.equal(clickAt(page, 320, 150).prevented, true);
});

test('8.5 review: a sibling button (even without text), a role=menu and a text-bearing menu pass the click through', () => {
  const { page, state } = anchoredPage();
  hover(page, 360, 200);
  const before = page.sent.length;
  for (const layer of [
    layerOf(page, 'BUTTON'),
    layerOf(page, 'DIV', { attrs: { role: 'menu' } }),
    layerOf(page, 'DIV', { textContent: 'Sign in' }),
    layerOf(page, 'INPUT'),
  ]) {
    state.stack = [layer, page.body];
    assert.equal(clickAt(page, 320, 150).prevented, false, layer.tagName + JSON.stringify(layer.attrs));
  }
  assert.equal(page.sent.length, before);
});

test('8.5 review: a big unrelated container whose text is beyond the probe is treated as text-free, not read in full', () => {
  const { page, state } = anchoredPage();
  hover(page, 360, 200);
  const empties = Array.from({ length: 500 }, () => ({ nodeValue: ' \n ' }));
  let visited = 0;
  const counted = new Proxy(empties.concat([{ nodeValue: 'far below the probe' }]), { get: (target, key) => { if (typeof key === 'string' && /^\d+$/.test(key)) visited += 1; return target[key]; } });
  state.stack = [layerOf(page, 'DIV', { textContent: 'far below the probe', textNodes: counted }), page.body];
  assert.equal(clickAt(page, 320, 150).prevented, true, 'text-free within the probe: the photo layer');
  assert.ok(visited <= 250, `read ${visited} text nodes`);
  state.stack = [layerOf(page, 'DIV', { textContent: 'Sign in', textNodes: [{ nodeValue: ' ' }, { nodeValue: 'Sign in' }] }), page.body];
  assert.equal(clickAt(page, 320, 150).prevented, false, 'text within the probe is site UI');
});

// 10.2: one interaction model. The page cursor, the hover message to the popup, the X ring and the full-size pill.
const rootCursor = (page) => page.document.documentElement.style.cursor;
const sentHovers = (page) => page.sent.filter((m) => m.action === 'overlayHover').map((m) => m.index);

test('10: the page root cursor is a pointer only while over a hovered card, and the previous cursor comes back', () => {
  const page = loadPage();
  page.document.documentElement.style.cursor = 'crosshair';
  showCards(page, [REST]);
  assert.equal(rootCursor(page), 'crosshair', 'not over a card');
  hover(page, 360, 200);
  assert.equal(rootCursor(page), 'pointer', 'over the box');
  hover(page, 700, 600);
  assert.equal(rootCursor(page), 'crosshair', 'restored after leaving');
  hover(page, 360, 200);
  assert.equal(rootCursor(page), 'pointer');
  page.send({ action: 'setOverlayShown', shown: false });
  page.flush();
  assert.equal(rootCursor(page), 'crosshair', 'restored when hidden');
});

test('10: the cursor is a pointer over the X and over the name card, and is restored on teardown and when the pointer leaves the window', () => {
  const page = loadPage({ globals: { clearTimeout, setTimeout } });
  showCards(page, [REST]);
  hover(page, 360, 200);
  hover(page, 428, 100);
  assert.equal(rootCursor(page), 'pointer', 'on the X');
  const name = page.rec.ops.find((o) => o.kind === 'text' && o.text === 'Drowzee');
  hover(page, name.rect.x1 + 2, name.rect.y1 + 2);
  assert.equal(rootCursor(page), 'pointer', 'on the name card');
  page.fire('mouseout', { relatedTarget: null });
  page.flush();
  assert.ok(!rootCursor(page), 'restored (empty) after the pointer left the window');
  hover(page, 360, 200);
  assert.equal(rootCursor(page), 'pointer');
  page.send({ action: 'clearOverlay' });
  assert.ok(!rootCursor(page), 'never left set after teardown');
});

test('10: hovering a card sends its index to the popup once, and none when the pointer leaves', () => {
  const page = loadPage();
  showCards(page, [REST]);
  assert.deepEqual(sentHovers(page), []);
  hover(page, 360, 200);
  hover(page, 365, 205);
  hover(page, 370, 210);
  assert.deepEqual(sentHovers(page), [0], 'one message for the card, none for moves inside it');
  hover(page, 900, 900);
  assert.deepEqual(sentHovers(page), [0, null]);
  hover(page, 360, 200);
  page.send({ action: 'setOverlayShown', shown: false });
  page.flush();
  assert.deepEqual(sentHovers(page), [0, null, 0, null], 'hiding the overlay ends the hover');
});

test('10: the X shows a hover ring when the pointer is on it', () => {
  const page = loadPage();
  showCards(page, [REST]);
  hover(page, 360, 200);
  const rings = () => page.rec.ops.filter((o) => o.kind === 'stroke' && o.raw && Math.abs((o.raw.x2 - o.raw.x1) - 24) < 0.01);
  assert.equal(rings().length, 0, 'no ring while the pointer is only on the card');
  hover(page, 428, 100);
  assert.ok(rings().length >= 1, 'a ring larger than the X is drawn');
});

test('10: leaving the page (pagehide) or hiding it ends the hover, so the popup does not keep a stale ring', () => {
  for (const leave of [(page) => page.fire('pagehide'), (page) => { page.document.visibilityState = 'hidden'; page.fire('visibilitychange'); }]) {
    const page = loadPage();
    page.document.documentElement.style.cursor = 'crosshair';
    showCards(page, [REST]);
    hover(page, 360, 200);
    assert.deepEqual(sentHovers(page), [0]);
    leave(page);
    assert.deepEqual(sentHovers(page), [0, null]);
    assert.equal(rootCursor(page), 'crosshair', 'the page cursor is restored');
  }
});

// 10 review: script, style and noscript text is not what the user sees, so a layer holding only that is not site UI.
test('10 review: text inside script, style and noscript does not make a layer site UI; real text still does', () => {
  const { page, state } = anchoredPage();
  hover(page, 360, 200);
  const hidden = (tag) => ({ nodeValue: 'var a = 1;', parentElement: { tagName: tag } });
  for (const tag of ['SCRIPT', 'STYLE', 'NOSCRIPT']) {
    state.stack = [layerOf(page, 'DIV', { textContent: 'var a = 1;', textNodes: [hidden(tag)] }), page.body];
    assert.equal(clickAt(page, 320, 150).prevented, true, `${tag} text is not visible text`);
  }
  state.stack = [layerOf(page, 'DIV', { textContent: 'Sign in', textNodes: [hidden('SCRIPT'), { nodeValue: 'Sign in', parentElement: { tagName: 'SPAN' } }] }), page.body];
  assert.equal(clickAt(page, 320, 150).prevented, false, 'visible text after a script is still site UI');
});

test('10: the full-size pill sends the popup\'s message and does not open a tab itself', () => {
  let opened = 0;
  const page = loadPage();
  page.window.open = () => { opened++; };
  page.send({ action: 'showOverlay', cards: [REST], srcWidth: 2504, srcHeight: 1287, fullSize: { url: 'https://photos.example/big.jpg' } });
  page.flush();
  const pill = page.rec.ops.find((o) => o.kind === 'text' && /^Open full-size photo/.test(o.text));
  assert.ok(pill, 'the pill is drawn');
  hover(page, pill.rect.x1 + 4, pill.rect.y1 + 4);
  assert.equal(rootCursor(page), 'pointer', 'a pointer over the pill, with no card hovered');
  const r = clickAt(page, pill.rect.x1 + 4, pill.rect.y1 + 4);
  assert.equal(r.prevented, true);
  assert.deepEqual(lastSent(page), { action: 'overlayFullSize' });
  assert.equal(opened, 0);
});

// 11.3: the first-scan legend. Shown once (remembered in chrome.storage.local), dismissible, drawn above the photo's cards.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const LEGEND_LINE = /^Hover a card for its name, click it to open it\.$/;
const legendOf = (page) => page.rec.ops.find((o) => o.kind === 'text' && LEGEND_LINE.test(o.text));

test('11.3: the first scan draws the legend once, above the cards, and remembers it was shown', async () => {
  const storage = {};
  const page = loadPage({ storage });
  showCards(page, [REST]);
  await settle();
  page.flush();
  const line = legendOf(page);
  assert.ok(line, `no legend: ${JSON.stringify(page.rec.texts())}`);
  assert.ok(page.rec.texts().some((t) => /Green: priced/.test(t)) && page.rec.texts().some((t) => /Blue: pick a version/.test(t)), JSON.stringify(page.rec.texts()));
  assert.ok(line.rect.y1 >= 0 && line.rect.y2 <= 1287, 'drawn on the page');
  assert.equal(storage.overlayLegendSeen, true);
  // A new page that reads the same storage does not show it again.
  const again = loadPage({ storage });
  showCards(again, [REST]);
  await settle();
  again.flush();
  assert.equal(legendOf(again), undefined);
});

test('11.3: a page with no storage, or a legend already seen, draws no legend', async () => {
  const bare = loadPage();
  showCards(bare, [REST]);
  await settle();
  bare.flush();
  assert.equal(legendOf(bare), undefined);
  const seen = loadPage({ storage: { overlayLegendSeen: true } });
  showCards(seen, [REST]);
  await settle();
  seen.flush();
  assert.equal(legendOf(seen), undefined);
});

test('11.3: the legend\'s close box dismisses it, takes the click, and it stays gone on the next pass', async () => {
  const page = loadPage({ storage: {} });
  showCards(page, [REST]);
  await settle();
  page.flush();
  const closes = page.rec.ops.filter((o) => o.kind === 'text' && o.text === '×');
  assert.equal(closes.length, 1, 'the legend\'s own close box (no card is hovered)');
  const x = (closes[0].rect.x1 + closes[0].rect.x2) / 2;
  const y = (closes[0].rect.y1 + closes[0].rect.y2) / 2;
  assert.equal(clickAt(page, x, y).prevented, true);
  page.flush();
  assert.equal(legendOf(page), undefined, 'gone after the click');
  showCards(page, [REST]);
  assert.equal(legendOf(page), undefined, 'a later push does not bring it back');
});

// A photo at `rect` with one Choose card inside it, a legend due, and a timer the test runs by hand.
async function legendPage(rect, { viewport } = {}) {
  const timers = [];
  const page = loadPage({ storage: {}, ...(viewport ? { viewport } : {}) });
  page.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  page.window.clearTimeout = () => {};
  const img = page.addImg(page.body, rectOf(rect.x, rect.y, rect.w, rect.h), { src: 'https://photos.example/binder.jpg' });
  page.stack((x, y) => (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h ? [img, page.body] : [page.body]));
  page.send({ action: 'findCards' });
  const card = { box: [rect.x + 40, rect.y + 60, rect.x + 240, rect.y + 340], identity: null, abstain: true, display: { state: 'choose' } };
  showCards(page, [card]);
  await settle();
  page.flush();
  return { page, timers, card };
}
const legendTop = (page) => page.rec.ops.find((o) => o.kind === 'text' && /^Green: priced/.test(o.text));

test('11.3: with room above the photo the legend sits above it and never over a card', async () => {
  const { page, card } = await legendPage({ x: 100, y: 200, w: 800, h: 600 });
  const line = legendTop(page);
  assert.ok(line, JSON.stringify(page.rec.texts()));
  assert.ok(line.rect.y2 <= 200, `legend text bottom ${line.rect.y2} is above the photo's top edge (200)`);
  assert.ok(line.rect.y2 <= card.box[1]);
});

test('11.3: with no room above, the legend sits just below the photo', async () => {
  const { page } = await legendPage({ x: 100, y: 20, w: 800, h: 500 });
  const line = legendTop(page);
  assert.ok(line, JSON.stringify(page.rec.texts()));
  assert.ok(line.rect.y1 >= 520, `legend text top ${line.rect.y1} is under the photo's bottom edge (520)`);
});

test('11.3: with room neither above nor below, the legend sits inside the photo and closes itself after 8 s', async () => {
  const { page, timers } = await legendPage({ x: 0, y: 0, w: 2489, h: 1287 });
  assert.ok(legendTop(page), 'drawn inside the photo');
  const close = timers.find((t) => t.ms === 8000);
  assert.ok(close, `an 8 s timer was set: ${JSON.stringify(timers.map((t) => t.ms))}`);
  close.fn();
  page.flush();
  assert.equal(legendTop(page), undefined, 'gone after the timer');
});

test('11.3: an inside legend closes on the first card hover', async () => {
  const { page, card } = await legendPage({ x: 0, y: 0, w: 2489, h: 1287 });
  assert.ok(legendTop(page));
  hover(page, (card.box[0] + card.box[2]) / 2, (card.box[1] + card.box[3]) / 2);
  assert.equal(legendTop(page), undefined, 'gone once a card is hovered');
});

test('11.3: an outside legend does not close on hover or by a timer', async () => {
  const { page, timers, card } = await legendPage({ x: 100, y: 200, w: 800, h: 600 });
  assert.equal(timers.length, 0);
  hover(page, (card.box[0] + card.box[2]) / 2, (card.box[1] + card.box[3]) / 2);
  assert.ok(legendTop(page), 'still there while a card is hovered');
});

test('11.3: a click on the legend\'s text is the page\'s own', async () => {
  const page = loadPage({ storage: {} });
  showCards(page, [REST]);
  await settle();
  page.flush();
  const line = legendOf(page);
  assert.equal(clickAt(page, line.rect.x1 + 4, line.rect.y1 + 2).prevented, false);
});
