import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { isRelatedHeading, isSealedListing } from '../tools/extension-wasm/lib/page-focus.js';

// content.js is a classic script injected into pages, so it cannot be imported. Run it against a bare
// stub page and use the pure helpers it exposes for tests.
function loadPure() {
  const source = fs.readFileSync(new URL('../tools/extension-wasm/content.js', import.meta.url), 'utf8');
  const window = { addEventListener() {}, innerWidth: 1100, innerHeight: 1200 };
  const document = { getElementById: () => null, documentElement: {}, querySelectorAll: () => [] };
  const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve() } };
  vm.runInNewContext(source, { window, document, chrome, MutationObserver: class {}, getComputedStyle: () => ({}) });
  return window.__cardScanner.pure;
}

const pure = loadPure();
const clip = (box, chain) => ({ ...pure.clipBox(box, chain) });

test('heading text keeps its letters: only whitespace is collapsed', () => {
  assert.equal(pure.tidyText('  Customers   also\n viewed '), 'Customers also viewed');
  for (const text of ['Sponsored', 'Other items', 'Customers also viewed', 'Other sellers', 'Inspired by your search']) {
    assert.equal(isRelatedHeading(pure.tidyText(`  ${text}\n`)), true, text);
  }
});

const slot = (left, top, right, bottom, extra = {}) => ({ position: 'static', clipX: true, clipY: true, root: false, rect: { left, top, right, bottom }, ...extra });
const img = (position = 'static') => ({ position });

test('an overflow-hidden gallery clips a slide that sits outside it', () => {
  const clipped = clip({ x1: 700, y1: 400, x2: 1200, y2: 900 }, [img(), slot(100, 400, 660, 960)]);
  assert.ok(clipped.x2 - clipped.x1 <= 0);
});

test('body and html never clip', () => {
  const whole = clip({ x1: 100, y1: 100, x2: 600, y2: 600 }, [img(), slot(0, 0, 300, 300, { root: true })]);
  assert.deepEqual(whole, { x1: 100, y1: 100, x2: 600, y2: 600 });
});

test('a position:fixed image is not clipped by ancestors', () => {
  const kept = clip({ x1: 100, y1: 100, x2: 600, y2: 600 }, [img('fixed'), slot(0, 0, 300, 300)]);
  assert.deepEqual(kept, { x1: 100, y1: 100, x2: 600, y2: 600 });
});

test('clipping stops at a fixed ancestor such as a lightbox', () => {
  const clipped = clip({ x1: 100, y1: 100, x2: 900, y2: 900 }, [
    img(),
    slot(200, 200, 700, 700, { position: 'fixed' }),
    slot(0, 0, 150, 150),
  ]);
  assert.deepEqual(clipped, { x1: 200, y1: 200, x2: 700, y2: 700 });
});

test('an absolutely positioned image ignores clipping ancestors between it and its containing block', () => {
  const kept = clip({ x1: 100, y1: 100, x2: 600, y2: 600 }, [
    img('absolute'),
    slot(0, 0, 300, 300),
    slot(0, 0, 1000, 1000, { position: 'relative' }),
  ]);
  assert.deepEqual(kept, { x1: 100, y1: 100, x2: 600, y2: 600 });
  const narrowed = clip({ x1: 100, y1: 100, x2: 600, y2: 600 }, [
    img('absolute'),
    slot(0, 0, 300, 300),
    slot(0, 0, 400, 400, { position: 'relative' }),
  ]);
  assert.deepEqual(narrowed, { x1: 100, y1: 100, x2: 400, y2: 400 });
});

test('only the first twelve ancestors are examined', () => {
  const chain = [img()];
  for (let i = 0; i < 20; i++) chain.push(slot(0, 0, 10000, 10000, { clipX: false, clipY: false }));
  chain.push(slot(0, 0, 50, 50));
  assert.deepEqual(clip({ x1: 0, y1: 0, x2: 500, y2: 500 }, chain), { x1: 0, y1: 0, x2: 500, y2: 500 });
});

test('sealed labels come from alt and aria text and need a sealed context word', () => {
  for (const label of ['Pokemon Elite Trainer Box', 'booster box photo', 'Ultra Premium Collection']) {
    assert.equal(pure.isSealedLabel(label), true, label);
  }
  for (const label of ['Umbreon tin foil holo', 'Binder page of cards', 'Playmat photo', 'Charizard bundle lot', 'Case of six cards']) {
    assert.equal(pure.isSealedLabel(label), false, label);
  }
});

test('the card-sold-with-a-pack wording rule is shared with the page-level verdict', () => {
  assert.equal(isSealedListing({ sealedLabel: true, titles: ['Charizard ex Booster Pack Fresh Pull'] }), false);
});


test('an element chain lists its own id then its ancestors, nearest first, with stable ids', () => {
  const page = { parentElement: null };
  const section = { parentElement: page };
  const img = { parentElement: section };
  const other = { parentElement: section };
  const chain = [...pure.chainOf(img)];
  assert.equal(chain.length, 3);
  assert.equal(chain[0], pure.idOf(img));
  assert.equal(chain[1], pure.idOf(section));
  assert.deepEqual([...pure.chainOf(other)].slice(1), chain.slice(1));
  assert.notEqual(pure.idOf(img), pure.idOf(other));
});

test('sourceHints gathers srcset, zoom-like data attributes and an enclosing link', () => {
  const attributes = [
    { name: 'src', value: 'https://cdn.example/t.jpg' },
    { name: 'data-zoom-src', value: 'https://cdn.example/z.jpg' },
    { name: 'data-large', value: 'https://cdn.example/l.jpg' },
    { name: 'data-index', value: '3' },
    { name: 'class', value: 'large' },
  ];
  const img = {
    attributes,
    srcset: 'https://cdn.example/a.jpg 900w',
    parentElement: { tagName: 'PICTURE', querySelectorAll: () => [{ srcset: 'https://cdn.example/b.webp 1200w' }] },
    closest: (selector) => (selector === 'a[href]' ? { href: 'https://cdn.example/full.jpg' } : null),
  };
  const hints = pure.sourceHints(img);
  assert.equal(hints.srcset, 'https://cdn.example/a.jpg 900w, https://cdn.example/b.webp 1200w');
  assert.deepEqual([...hints.attrs], ['https://cdn.example/z.jpg', 'https://cdn.example/l.jpg']);
  assert.equal(hints.link, 'https://cdn.example/full.jpg');
  const empty = pure.sourceHints({ attributes: [], closest: () => null });
  assert.deepEqual([empty.srcset, [...empty.attrs], empty.link], ['', [], '']);
});

// A page stub rich enough for the scan itself: text nodes come from an element's `texts`.
function loadPage({ images = [], sources = [], headings = [], performance, computed = () => ({}) } = {}) {
  const source = fs.readFileSync(new URL('../tools/extension-wasm/content.js', import.meta.url), 'utf8');
  const window = { addEventListener() {}, innerWidth: 1100, innerHeight: 1200 };
  const document = {
    baseURI: 'https://shop.example/item/1',
    getElementById: () => null,
    documentElement: {},
    querySelectorAll: (selector) => {
      if (selector === 'img') return images;
      if (selector === 'picture source[srcset]') return sources;
      if (selector.startsWith('h1,h2')) return headings;
      return [];
    },
    createTreeWalker: (root) => {
      const texts = root?.texts || [];
      let at = 0;
      return { currentNode: null, nextNode: () => (at < texts.length ? { nodeValue: texts[at++], nodeType: 3 } : null) };
    },
  };
  const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve() } };
  vm.runInNewContext(source, { window, document, chrome, URL, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, performance, MutationObserver: class {}, getComputedStyle: computed });
  return window.__cardScanner;
}

test('the carousel and heading caches are rebuilt at the start of every scan', () => {
  const style = { overflowX: 'auto' };
  const strip = { parentElement: null, scrollWidth: 900, clientWidth: 300 };
  const slide = { parentElement: strip };
  const heading = { matches: () => true, querySelector: () => null, childElementCount: 0, texts: ['Similar items'], previousElementSibling: null };
  const item = { previousElementSibling: heading };
  const scanner = loadPage({ computed: () => style });
  assert.equal(scanner.pure.scrollsHorizontally(slide), true);
  assert.equal(scanner.pure.headingBefore(item), 'Similar items');

  style.overflowX = 'visible';
  heading.texts = ['Other items'];
  assert.equal(scanner.pure.scrollsHorizontally(slide), true, 'cached within one scan');
  assert.equal(scanner.pure.headingBefore(item), 'Similar items', 'cached within one scan');

  scanner.find();
  assert.equal(scanner.pure.scrollsHorizontally(slide), false);
  assert.equal(scanner.pure.headingBefore(item), 'Other items');
});

const fakeHeading = (texts, extra = {}) => ({
  tagName: 'H2', childElementCount: 0, parentElement: null, texts,
  getAttribute: () => null,
  querySelector: () => null,
  get textContent() { throw new Error('textContent must not be read'); },
  ...extra,
});

test('heading text is read from a bounded prefix, never the whole subtree', () => {
  const visited = [];
  const huge = fakeHeading(new Proxy([], {
    get(target, key) {
      if (key === 'length') return 5000;
      if (typeof key === 'string' && /^\d+$/.test(key)) { visited.push(Number(key)); return 'word '; }
      return target[key];
    },
  }));
  const small = fakeHeading(['Similar ', 'items']);
  const crowded = fakeHeading(['Looks fine'], { childElementCount: 50 });
  const scanner = loadPage({ headings: [huge, crowded, small] });
  const found = scanner.pure.collectHeadings();
  assert.deepEqual([...found].map((h) => h.text), ['Similar items']);
  assert.ok(visited.length <= 60, `walked ${visited.length} text nodes`);
  assert.equal(scanner.pure.boundedText(crowded), '', 'an element with many children is skipped outright');
  assert.ok(scanner.pure.boundedText(huge).length <= 200);
});

test('a labelled container keeps its aria-label without touching its text', () => {
  const region = fakeHeading(['x'.repeat(5000)], { tagName: 'SECTION', getAttribute: (name) => (name === 'aria-label' ? 'Similar items' : null) });
  const found = loadPage({ headings: [region] }).pure.collectHeadings();
  assert.deepEqual([...found].map((h) => h.text), ['Similar items']);
});

test('image hosts come from the page images, their srcsets and the image and css resources it loaded', () => {
  const images = [
    { currentSrc: 'https://i.cdn.example/a-300.jpg', src: 'https://lazy.example/a.jpg', srcset: 'https://i.cdn.example/a-900.jpg 900w, https://big.cdn.example/a,w_1200/x.jpg 1200w' },
    { currentSrc: '', src: 'data:image/gif;base64,AAAA', srcset: '' },
    { currentSrc: '/local/b.jpg', src: '', srcset: '' },
  ];
  const sources = [{ srcset: 'https://pic.example/c.webp 800w' }];
  const entries = [
    { initiatorType: 'img', name: 'https://tracker.example/pixel.gif' },
    { initiatorType: 'css', name: 'https://fonts.example/bg.jpg' },
    { initiatorType: 'script', name: 'https://scripts.example/app.js' },
    { initiatorType: 'fetch', name: 'https://api.example/data.json' },
  ];
  const hosts = loadPage({ images, sources, performance: { getEntriesByType: () => entries } }).pure.collectImageHosts();
  assert.deepEqual([...hosts].sort(), ['big.cdn.example', 'fonts.example', 'i.cdn.example', 'lazy.example', 'pic.example', 'shop.example', 'tracker.example']);
});

test('image hosts work without the performance API and stop at a bound', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ currentSrc: `https://h${i}.example/a.jpg`, src: '', srcset: '' }));
  const hosts = loadPage({ images: many }).pure.collectImageHosts();
  assert.equal(hosts.length, 200);
  assert.deepEqual([...loadPage({}).pure.collectImageHosts()], []);
});

test('a card label shows only its name and one price', () => {
  const id = { name: 'Charmeleon', set: 'Base Set', number: '24' };
  const label = (card) => ({ ...pure.labelText(card) });
  assert.deepEqual(label({ identity: id, display: { price: 4.5, printing: 'Normal', condition: 'NM', footer: 'TCGPlayer' } }), { name: 'Charmeleon', price: '$4.50' });
  assert.deepEqual(label({ identity: id, display: { price: null, printingNote: 'Several versions · $0.71–$8.63' } }), { name: 'Charmeleon', price: '$0.71–$8.63', caveat: 'Pick a version' });
  const grid = { variants: { normal: { market: 1.25 }, holofoil: { market: 38.99 } } };
  assert.deepEqual(label({ identity: id, price_grid: grid }), { name: 'Charmeleon', price: '$1.25–$38.99' });
  assert.deepEqual(label({ identity: id, market_price: 2 }), { name: 'Charmeleon', price: '$2.00' });
  assert.equal(label({ identity: id }).price, '—');
  // A card to choose has no name on its label: the label asks for a pick and never asserts a card.
  assert.equal(label({ identity: null, abstain: true }).name, 'Choose a card');
  assert.equal(label({ identity: id, display: { state: 'choose' } }).name, 'Choose a card');
  assert.equal(label({ cardBack: true, display: { state: 'none' } }).name, 'Not recognised');
});

test('a card with an old price shows its name and "Old price", never the price', () => {
  const id = { name: 'Charmeleon', number: '24' };
  assert.deepEqual({ ...pure.labelText({ identity: id, display: { price: 4.5, stale: true } }) }, { name: 'Charmeleon', price: 'Old price', muted: true });
  assert.deepEqual({ ...pure.labelText({ identity: id, display: { price: null, printingNote: 'set not sure · $0.71–$8.63', stale: true } }) }, { name: 'Charmeleon', price: 'Old price', muted: true });
  const chip = JSON.parse(JSON.stringify(pure.chipSpec({ identity: id, display: { state: 'identified', price: 4.5, stale: true } })));
  assert.equal(chip.text, '—');
  assert.ok(!JSON.stringify(chip).includes('4.50'));
  // A fresh price is unchanged.
  assert.equal(pure.chipSpec({ identity: id, display: { state: 'identified', price: 4.5 } }).text, '$4.50');
});

test('the overlay takes only trusted clicks, never one a page script dispatched', () => {
  assert.equal(pure.acceptClick({ isTrusted: true }), true);
  assert.equal(pure.acceptClick({ isTrusted: false }), false);
  assert.equal(pure.acceptClick({}), false);
  assert.equal(pure.acceptClick(null), false);
});

test('hovering picks the smallest card frame under the pointer', () => {
  const frame = (x, y, w, h) => ({ rect: { x, y, w, h } });
  const targets = [frame(0, 0, 600, 400), frame(10, 10, 100, 140), frame(200, 10, 100, 140)];
  assert.equal(pure.hoveredTarget(targets, null, null), null);
  assert.equal(pure.hoveredTarget(targets, null, { x: 50, y: 50 }), 1);
  assert.equal(pure.hoveredTarget(targets, null, { x: 250, y: 50 }), 2);
  assert.equal(pure.hoveredTarget(targets, null, { x: 400, y: 300 }), 0);
  assert.equal(pure.hoveredTarget(targets, null, { x: 900, y: 900 }), null);
});

test('an open label stays open while the pointer is on it, even past a small card', () => {
  const targets = [{ rect: { x: 10, y: 10, w: 60, h: 90 } }];
  const hover = { target: 0, rect: { x: 14, y: 14, w: 200, h: 48 } };
  assert.equal(pure.hoveredTarget(targets, hover, { x: 180, y: 40 }), 0);
  assert.equal(pure.hoveredTarget(targets, hover, { x: 400, y: 40 }), null);
  assert.equal(pure.hoveredTarget([], hover, { x: 180, y: 40 }), null);
});

test('hovering a card\'s tag opens its label, even where the tag sits outside the card', () => {
  const targets = [{ rect: { x: 0, y: 0, w: 600, h: 400 } }, { rect: { x: 100, y: 100, w: 72, h: 100 }, tag: { x: 102, y: 74, w: 60, h: 24 } }];
  assert.equal(pure.hoveredTarget(targets, null, { x: 120, y: 80 }), 1);
  assert.equal(pure.hoveredTarget(targets, null, { x: 300, y: 300 }), 0);
});

// The hover label, laid out with a stub of 7.5 px per character (D3/D4 of the 2026-10-25 QA gate).
const perChar = (t) => String(t).length * 7.5;
const viewport = { x1: 0, y1: 0, x2: 1100, y2: 1200 };
const labelOf = (box, card, clipRect = viewport) => plainJson(pure.labelLayout(box, card, clipRect, perChar));
const plainJson = (value) => JSON.parse(JSON.stringify(value));
const darkSlowbro = { identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Dark Slowbro', price: 51.51 } } };

test('D4: the hovered label of a small card shows its full name and its whole price or ask, wider than the box', () => {
  const choose = labelOf([100, 100, 172, 200], darkSlowbro);
  const texts = choose.lines.map((l) => l.text);
  assert.ok(texts.includes('Dark Slowbro? ~$51.51'), JSON.stringify(texts));
  assert.ok(texts.includes('Click to pick it in the scanner'), JSON.stringify(texts));
  assert.ok(choose.w > 72, 'the label may be wider than the 72 px box');

  const drowzee = labelOf([300, 100, 428, 275], { identity: { name: 'Drowzee', number: '61' }, display: { state: 'identified', price: 0.07 } });
  assert.deepEqual(drowzee.lines.map((l) => l.text), ['Drowzee', '$0.07']);

  const entei = labelOf([500, 100, 639, 290], { identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 3.1 } } });
  assert.equal(entei.lines[0].text, 'Entei? ~$3.10');
});

test('D4: the expanded label stays inside the visible photo rect and the viewport', () => {
  const photo = { x1: 400, y1: 300, x2: 640, y2: 700 };
  const inside = (r, c) => r.x >= c.x1 && r.y >= c.y1 && r.x + r.w <= c.x2 && r.y + r.h <= c.y2;
  for (const box of [[566, 320, 638, 420], [402, 640, 474, 740], [600, 250, 700, 350]]) {
    const label = labelOf(box, darkSlowbro, photo);
    assert.ok(inside(label, photo), `${JSON.stringify(box)} -> ${JSON.stringify(label)}`);
  }
  // A photo narrower than the text: the label fills the photo's width and the text is cut to it, never past it.
  const narrow = { x1: 400, y1: 300, x2: 520, y2: 700 };
  const cut = labelOf([410, 320, 482, 420], darkSlowbro, narrow);
  assert.ok(inside(cut, narrow), JSON.stringify(cut));
  assert.ok(cut.lines.every((l) => perChar(l.text) <= cut.w), JSON.stringify(cut.lines));
  // At the right edge of the viewport.
  const edge = labelOf([1040, 100, 1098, 200], darkSlowbro);
  assert.ok(edge.x + edge.w <= 1100 && edge.x >= 0, JSON.stringify(edge));
});

test('the name card opens just outside the card: above, left-aligned; else below; else inside at the bottom', () => {
  const card = { identity: { name: 'Charizard', number: '4' }, display: { state: 'identified', price: 954.65 } };
  const overlapsTopHalf = (l, box) => l.x < box[2] && box[0] < l.x + l.w && l.y < (box[1] + box[3]) / 2 && box[1] < l.y + l.h;
  // Room above: the name card sits above the top edge, left edge on the card's.
  const mid = [300, 300, 372, 420];
  const above = labelOf(mid, card);
  assert.equal(above.side, 'above');
  assert.equal(above.x, mid[0]);
  assert.ok(above.y + above.h <= mid[1], JSON.stringify(above));
  assert.ok(!overlapsTopHalf(above, mid));
  // Top row: no room above inside the photo, so it goes below the bottom edge, still inside the photo.
  const photo = { x1: 0, y1: 0, x2: 1100, y2: 600 };
  const topRow = labelOf([300, 20, 372, 160], card, photo);
  assert.equal(topRow.side, 'below');
  assert.ok(topRow.y >= 160, JSON.stringify(topRow));
  assert.ok(topRow.y + topRow.h <= photo.y2);
  // Under a site bar: the photo's visible rect starts at y 56, so a card at 60 cannot take the name above it either.
  const bar = labelOf([300, 60, 372, 200], card, { x1: 0, y1: 56, x2: 1100, y2: 600 });
  assert.equal(bar.side, 'below');
  assert.ok(bar.y >= 56);
  // No room above or below (a tall card filling the photo): inside the card, at the bottom, whole inside the photo.
  const tall = labelOf([300, 10, 372, 590], card, photo);
  assert.equal(tall.side, 'inside');
  assert.ok(tall.y + tall.h <= 590 && tall.y >= 10 + (590 - 10) / 2, JSON.stringify(tall));
  // A card at the photo's right edge: the name card keeps to the photo, so it is shifted left of the card's left edge.
  const right = labelOf([1040, 300, 1098, 420], card);
  assert.ok(right.x + right.w <= 1100 && right.side === 'above');
  // The hover area joins the name card to the card, so the pointer can travel from one to the other.
  assert.equal(above.hit.y + above.hit.h, mid[1]);
  assert.equal(above.hit.y, above.y);
  assert.equal(topRow.hit.y, 160);
  assert.equal(topRow.hit.y + topRow.hit.h, topRow.y + topRow.h);
  assert.deepEqual({ x: tall.hit.x, y: tall.hit.y, w: tall.hit.w, h: tall.hit.h }, { x: tall.x, y: tall.y, w: tall.w, h: tall.h });
});

test('an inside name card keeps clear of the card\'s chip: bottom-left, else just above the chip row', () => {
  const card = { identity: { name: 'Charizard', number: '4' }, display: { state: 'identified', price: 954.65 } };
  const photo = { x1: 0, y1: 0, x2: 1100, y2: 600 };
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // A card filling the photo's height: no room above or below. Narrow card: the name card is wider than the card, so it would sit on the chip.
  const narrow = [300, 10, 372, 590];
  const narrowChip = { x: 372 - 4 - 54, y: 590 - 4 - 22, w: 54, h: 22 };
  const covered = labelOf(narrow, card, photo);
  assert.equal(covered.side, 'inside');
  assert.ok(hits(covered, narrowChip), 'without the chip given it lands on the chip (the old behaviour)');
  const clear = plainJson(pure.labelLayout(narrow, card, photo, perChar, narrowChip));
  assert.equal(clear.side, 'inside');
  assert.ok(!hits(clear, narrowChip), JSON.stringify(clear));
  assert.ok(clear.y + clear.h <= narrowChip.y, 'just above the chip row');
  assert.ok(clear.x >= photo.x1 && clear.x + clear.w <= photo.x2 && clear.y >= photo.y1 && clear.y + clear.h <= photo.y2);
  // A wide card: the name card stays at the bottom-left and the chip at the bottom-right do not meet.
  const wide = [300, 10, 700, 590];
  const wideChip = { x: 700 - 4 - 54, y: 590 - 4 - 22, w: 54, h: 22 };
  const left = plainJson(pure.labelLayout(wide, card, photo, perChar, wideChip));
  assert.equal(left.side, 'inside');
  assert.equal(left.x, 300);
  assert.ok(!hits(left, wideChip));
  assert.ok(left.y + left.h <= 590);
});

test('the name card shows the name, then " #number" in a second colour, then the price or the ask', () => {
  const card = { identity: { name: 'Charizard', number: '4' }, display: { state: 'identified', price: 954.65 } };
  const got = labelOf([300, 300, 372, 420], card);
  assert.deepEqual(got.lines.map((l) => l.text), ['Charizard', '$954.65']);
  assert.equal(got.lines[0].suffix, ' #4');
  assert.equal(got.lines[1].color, '#3DD9A0');
  // An action line is 13 px, a price 17 px; a Choose card has no number.
  const choose = labelOf([300, 300, 372, 420], darkSlowbro);
  assert.equal(choose.lines[0].suffix, undefined);
  assert.equal(choose.lines[1].px, 13);
  assert.equal(got.lines[1].px, 17);
  assert.equal(choose.lines[1].color, '#FBBF24');
});

test('a small Choose card\'s chip never shows a bare price: "? ~$x" marked unconfirmed, or a dot', () => {
  // 72 px card: a 64 px chip would be the most that fits; "? ~$51.51" does not, so a dot shows, never "$51.51" alone.
  const got = plainJson(pure.chipLayout(darkSlowbro, 72, perChar));
  assert.equal(got.kind, 'dot');
  const roomy = plainJson(pure.chipLayout(darkSlowbro, 140, perChar));
  assert.deepEqual(roomy.parts.map((p) => p.text), ['?', '~$51.51']);
});

test('fitText ellipsizes to the width and leaves short text alone', () => {
  const measure = (t) => t.length * 10;
  assert.equal(pure.fitText('abc', 30, measure), 'abc');
  assert.equal(pure.fitText('abcdefgh', 50, measure), 'abcd…');
  assert.ok(measure(pure.fitText('abcdefgh', 50, measure)) <= 50);
  assert.equal(pure.fitText('abcdefgh', 5, measure), '');
});

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

test('a box stored relative to its element follows the element when it moves or resizes', () => {
  const captured = rect(100, 200, 300, 480);
  const rel = pure.boxToRel([120, 220, 220, 360], captured);
  assert.deepEqual([...pure.relToBox(rel, captured)], [120, 220, 220, 360]);
  assert.deepEqual([...pure.relToBox(rel, rect(100, -400, 300, -120))], [120, -380, 220, -240]);
  assert.deepEqual([...pure.relToBox(rel, rect(0, 0, 400, 560))], [40, 40, 240, 320]);
});

test('an element with no size cannot anchor a box', () => {
  assert.equal(pure.boxToRel([0, 0, 10, 10], rect(5, 5, 5, 50)), null);
  assert.equal(pure.boxToRel([0, 0, 10, 10], rect(5, 5, 50, 5)), null);
});

test('document coordinates survive scrolling', () => {
  const doc = pure.boxToDoc([50, 80, 150, 220], { x: 0, y: 600 });
  assert.deepEqual([...doc], [50, 680, 150, 820]);
  assert.deepEqual([...pure.docToBox(doc, { x: 0, y: 1000 })], [50, -320, 150, -180]);
  assert.deepEqual([...pure.docToBox(doc, { x: 20, y: 600 })], [30, 80, 130, 220]);
});

test('the anchor is the smallest element that holds the box', () => {
  const anchors = [{ rect: rect(0, 0, 800, 800) }, { rect: rect(100, 100, 400, 500) }, { rect: rect(450, 100, 750, 500) }];
  assert.equal(pure.pickAnchor([120, 120, 380, 480], anchors), 1);
  assert.equal(pure.pickAnchor([470, 120, 730, 480], anchors), 2);
  assert.equal(pure.pickAnchor([10, 600, 90, 700], anchors), 0);
});

test('a box that mostly lies outside every element has no anchor', () => {
  const anchors = [{ rect: rect(100, 100, 200, 200) }];
  assert.equal(pure.pickAnchor([150, 100, 350, 200], anchors), -1);
  assert.equal(pure.pickAnchor([500, 500, 600, 600], anchors), -1);
  assert.equal(pure.pickAnchor([0, 0, 10, 10], []), -1);
});

test('only boxes that reach the viewport are drawn', () => {
  assert.equal(pure.boxInView([10, 10, 100, 100], 1100, 800), true);
  assert.equal(pure.boxInView([10, -300, 100, -1], 1100, 800), false);
  assert.equal(pure.boxInView([10, 800, 100, 900], 1100, 800), false);
  assert.equal(pure.boxInView([-90, 10, -1, 100], 1100, 800), false);
  assert.equal(pure.boxInView([-50, 700, 50, 900], 1100, 800), true);
});

function loadWithMessages() {
  const source = fs.readFileSync(new URL('../tools/extension-wasm/content.js', import.meta.url), 'utf8');
  const frames = [];
  const window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1100, innerHeight: 800, scrollX: 0, scrollY: 0, requestAnimationFrame: (fn) => frames.push(fn) && frames.length, cancelAnimationFrame() {} };
  const canvas = { style: {}, remove() {}, getBoundingClientRect: () => ({ width: 1100, height: 800 }), getContext: () => ({ clearRect() {}, setTransform() {} }) };
  const document = { getElementById: () => null, createElement: () => canvas, documentElement: { appendChild() {} }, querySelectorAll: () => [] };
  let listener;
  const chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: () => Promise.resolve() } };
  vm.runInNewContext(source, { window, document, chrome, MutationObserver: class {}, getComputedStyle: () => ({}) });
  const send = (msg) => { const replies = []; listener(msg, null, (r) => replies.push(r)); return replies; };
  const nextFrame = () => frames.shift()();
  return { canvas, send, nextFrame, frames };
}

test('hiding the overlay answers only after two frames, so a capture cannot include the badges', () => {
  const page = loadWithMessages();
  page.send({ action: 'showOverlay', cards: [], srcWidth: 1100, srcHeight: 800 });
  const replies = page.send({ action: 'hideOverlay' });
  assert.equal(page.canvas.style.visibility, 'hidden');
  assert.equal(replies.length, 0);
  page.nextFrame();
  assert.equal(replies.length, 0);
  page.nextFrame();
  assert.equal(replies.length, 1);
});

test('a new overlay shows again after a hide, and hiding with no overlay answers at once', () => {
  const page = loadWithMessages();
  assert.equal(page.send({ action: 'hideOverlay' }).length, 1);
  page.send({ action: 'showOverlay', cards: [], srcWidth: 1100, srcHeight: 800 });
  page.send({ action: 'hideOverlay' });
  page.send({ action: 'showOverlay', cards: [], srcWidth: 1100, srcHeight: 800 });
  assert.equal(page.canvas.style.visibility, 'visible');
});

test('restoreOverlay brings back a hidden overlay', () => {
  const page = loadWithMessages();
  page.send({ action: 'showOverlay', cards: [], srcWidth: 1100, srcHeight: 800 });
  page.send({ action: 'hideOverlay' });
  page.send({ action: 'restoreOverlay' });
  assert.equal(page.canvas.style.visibility, 'visible');
});

test('every card\'s chip says only its price, marked by its state: identified, printing to pick, choose, none, skipped', () => {
  const id = { name: 'Charizard', number: '4' };
  const chip = (card) => plain(pure.chipSpec(card));
  // Identified: the price, or a dash when there is none or it is old.
  assert.deepEqual(chip({ identity: id, display: { state: 'identified', price: 954.65 } }), { state: 'identified', marks: [], text: '$954.65' });
  assert.equal(chip({ identity: id, display: { state: 'identified' } }).text, '—');
  assert.equal(chip({ identity: id, display: { state: 'identified', price: 4.5, stale: true } }).text, '—');
  // Printing to pick: the range with one dollar sign; "set not sure" moves to the hover card.
  assert.deepEqual(chip({ identity: id, display: { state: 'printing', printingNote: 'set not sure · $120.00–$950.00' } }), { state: 'printing', marks: [], text: '$120.00–950.00' });
  assert.equal(chip({ identity: id, display: { state: 'printing', printingNote: '3 variants · $0.60–$2.01' } }).text, '$0.60–2.01');
  assert.equal(chip({ identity: id, display: { state: 'printing' } }).text, '—');
  // Choose: the best match's price marked unconfirmed, "Pick" with no price (11.3), and never an unmarked figure.
  assert.deepEqual(chip({ identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 0.74 } } }), { state: 'choose', marks: ['?'], text: '~$0.74' });
  assert.deepEqual(chip({ identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: null, kind: 'none' } } }), { state: 'choose', marks: [], text: 'Pick' });
  assert.deepEqual(chip({ identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 0.74, stale: true } } }), { state: 'choose', marks: [], text: 'Pick' });
  assert.deepEqual(chip({ identity: id, display: { state: 'choose' } }), { state: 'choose', marks: [], text: 'Pick' });
  assert.deepEqual(chip({ identity: id, display: { state: 'choose', highValue: true } }), { state: 'choose', marks: ['!'], text: 'Pick' });
  // High value: a "!" before the text.
  assert.deepEqual(chip({ identity: id, display: { state: 'identified', price: 120, highValue: true } }), { state: 'identified', marks: ['!'], text: '$120.00' });
  assert.deepEqual(chip({ identity: null, abstain: true, display: { state: 'choose', highValue: true, guess: { name: 'Entei', price: 120 } } }), { state: 'choose', marks: ['!', '?'], text: '~$120.00' });
  // Not recognised and too small: "?" alone. Skipped: no chip.
  assert.deepEqual(chip({ cardBack: true }), { state: 'none', marks: [], text: '?' });
  assert.deepEqual(chip({ cardBack: true, tooSmall: true }), { state: 'none', marks: [], text: '?' });
  assert.equal(pure.chipSpec({ identity: id, display: { state: 'skipped' } }), null);
});

test('chip layout: the whole chip, "from $x" for a range that does not fit, else a dot; never a cut number', () => {
  const m = perChar; // 7.5 px per character; a space is 7.5 px
  const id = { name: 'Charizard', number: '4' };
  const layout = (card, w) => plain(pure.chipLayout(card, w, m));
  const price = { identity: id, display: { state: 'identified', price: 3.49 } };
  // 3 px rail + 7 px padding each side around the text: 17 + 5 * 7.5.
  assert.deepEqual(layout(price, 140), { kind: 'chip', state: 'identified', w: 54.5, h: 22, parts: [{ text: '$3.49', x: 10, mark: false }] });
  // The marks sit before the text, a space apart.
  const choose = { identity: null, abstain: true, display: { state: 'choose', guess: { name: 'Entei', price: 0.74 } } };
  assert.deepEqual(layout(choose, 140).parts, [{ text: '?', x: 10, mark: true }, { text: '~$0.74', x: 25, mark: false }]);
  // The range: whole at 17 + 82.5, as "from $0.60" at 17 + 75, else a dot.
  const range = { identity: id, display: { state: 'printing', printingNote: 'set not sure · $0.60–$12.01' } };
  assert.deepEqual(layout(range, 110).parts.map((p) => p.text), ['$0.60–12.01']);
  assert.deepEqual(layout(range, 105).parts.map((p) => p.text), ['from $0.60']);
  assert.equal(layout(range, 105).w, 92);
  assert.deepEqual(layout(range, 98), { kind: 'dot', state: 'printing', w: 10, h: 10 });
  // A chip must fit inside the card's visible width minus 8 px: a 70 px card shows a dot for a Choose price, a chip for a short one.
  assert.equal(layout(choose, 70).kind, 'dot');
  assert.equal(layout(price, 70).kind, 'chip');
  assert.ok(layout(price, 70).w <= 70 - 8);
  assert.equal(layout(price, 60).kind, 'dot');
  assert.equal(layout({ cardBack: true }, 70).kind, 'chip');
  // A dot says its state; a chip's text is never cut.
  for (const w of [30, 50, 62, 70, 90, 120]) {
    const got = layout(choose, w);
    if (got.kind === 'chip') assert.ok(got.w <= w - 8 && got.parts.every((p) => !p.text.includes('…')), `${w}: ${JSON.stringify(got)}`);
  }
});

test('cardState: the popup\'s verdict, else the card\'s own fields', () => {
  const id = { name: 'Charizard', number: '4' };
  assert.equal(pure.cardState({ identity: null, abstain: true }), 'choose');
  assert.equal(pure.cardState({ cardBack: true }), 'none');
  // Straight from the background, before the popup has drawn: the card's own fields decide.
  assert.equal(pure.cardState({ identity: id, unsure: true }), 'choose');
  // The removed guess tier is not a state any more.
  assert.equal(pure.cardState({ identity: id, display: { state: 'guess', guess: { name: 'Charizard' } } }), 'identified');
  assert.equal(pure.cardState({ identity: id, confidence: 0.9 }), 'identified');
});

const plain = (value) => JSON.parse(JSON.stringify(value));

test('the price chip sits in the bottom-right corner, then top-right, below, above; never on another chip', () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 };
  const box = [100, 100, 200, 240];
  const first = plain(pure.placeChip(box, 54, 22, [], view));
  // 4 px in from both edges of the card.
  assert.deepEqual(first, { x: 200 - 4 - 54, y: 240 - 4 - 22, w: 54, h: 22 });
  const top = plain(pure.placeChip(box, 54, 22, [first], view));
  assert.deepEqual(top, { x: 142, y: 104, w: 54, h: 22 });
  const below = plain(pure.placeChip(box, 54, 22, [first, top], view));
  assert.deepEqual(below, { x: 142, y: 242, w: 54, h: 22 });
  const above = plain(pure.placeChip(box, 54, 22, [first, top, below], view));
  assert.deepEqual(above, { x: 142, y: 100 - 22 - 2, w: 54, h: 22 });
  assert.equal(pure.placeChip(box, 54, 22, [first, top, below, above], view), null);
});

test('the price chip stays inside the visible photo: nothing over a bar above it, nothing past its bottom', () => {
  // A site bar covers the top 56 px: the card's top-right inside spot starts under it.
  const bar = { x: 0, y: 56, w: 1000, h: 744 };
  const box = [100, 0, 200, 140];
  const bottom = plain(pure.placeChip(box, 54, 22, [], bar));
  assert.equal(bottom.y, 140 - 4 - 22);
  const top = plain(pure.placeChip(box, 54, 22, [bottom], bar));
  assert.equal(top.y, 56 + 4);
  const below = plain(pure.placeChip(box, 54, 22, [bottom, top], bar));
  assert.equal(below.y, 142);
  // Above the card is under the bar: nothing is free.
  assert.equal(pure.placeChip(box, 54, 22, [bottom, top, below], bar), null);
  // A card at the photo's bottom edge: below does not fit, above does.
  const view = { x: 0, y: 0, w: 1000, h: 800 };
  const low = [100, 660, 200, 800];
  const inside = [{ x: 142, y: 774, w: 54, h: 22 }, { x: 142, y: 664, w: 54, h: 22 }];
  assert.deepEqual(plain(pure.placeChip(low, 54, 22, inside, view)), { x: 142, y: 660 - 22 - 2, w: 54, h: 22 });
  for (const spot of [first(view, low), first(view, [100, 0, 200, 140])]) {
    assert.ok(spot.x >= view.x && spot.y >= view.y && spot.x + spot.w <= view.x + view.w && spot.y + spot.h <= view.y + view.h);
  }
  function first(v, b) { return plain(pure.placeChip(b, 54, 22, [], v)); }
});

test('a chip\'s click area is at least 28 px tall (and wide, for a dot) around the drawn chip', () => {
  assert.deepEqual(plain(pure.chipHit({ x: 142, y: 214, w: 54, h: 22 })), { x: 142, y: 211, w: 54, h: 28 });
  assert.deepEqual(plain(pure.chipHit({ x: 190, y: 220, w: 10, h: 10 })), { x: 181, y: 211, w: 28, h: 28 });
  assert.deepEqual(plain(pure.chipHit({ x: 10, y: 10, w: 60, h: 30 })), { x: 10, y: 10, w: 60, h: 30 });
});

test('corner bracket arms are 18 px, or 22% of the shorter side on a small card', () => {
  assert.equal(pure.bracketArm(100, 140), 18);
  assert.equal(pure.bracketArm(400, 560), 18);
  assert.ok(Math.abs(pure.bracketArm(60, 80) - 13.2) < 1e-9);
  assert.ok(Math.abs(pure.bracketArm(300, 40) - 8.8) < 1e-9);
  assert.equal(pure.bracketArm(0, 100), 0);
});

test('a price is never cut mid-number: the whole of it, or "from" its lower bound, or nothing', () => {
  const m = (t) => t.length * 7; // 7 px per character
  assert.equal(pure.fitPrice('$1.43–$20.00', 100, m), '$1.43–$20.00');
  assert.equal(pure.fitPrice('$1.43–$20.00', 80, m), 'from $1.43');
  assert.equal(pure.fitPrice('$1.43–$20.00', 50, m), '');
  assert.equal(pure.fitPrice('$9.99', 20, m), '');
});

test('a skipped card has no chip and a Skipped label with no name or price, even if the card carries a price', () => {
  const id = { name: 'Charizard', number: '4' };
  const card = { identity: id, price_grid: { variants: { normal: { market: 9 } } }, display: { state: 'skipped' } };
  assert.equal(pure.cardState(card), 'skipped');
  assert.equal(pure.chipSpec(card), null);
  assert.equal(pure.chipLayout(card, 200, (text) => text.length * 7), null);
  const label = JSON.parse(JSON.stringify(pure.labelText(card)));
  assert.equal(label.name, 'Skipped');
  assert.doesNotMatch(JSON.stringify(label), /Charizard|\$/);
});

test('11.3: the name card of a card whose version is open says "Pick a version · range", and a Choose card says "Click"', () => {
  const open = { identity: { name: 'Charizard', number: '4' }, display: { state: 'printing', number: '4', printingNote: 'Several versions · $0.60–$12.01' } };
  const lines = labelOf([100, 100, 300, 380], open).lines.map((l) => l.text);
  assert.ok(lines.includes('Pick a version · $0.60–$12.01'), JSON.stringify(lines));
  assert.ok(!lines.some((t) => /set not sure|several versions/i.test(t)), JSON.stringify(lines));
  const high = labelOf([100, 100, 300, 380], { identity: null, abstain: true, display: { state: 'choose', highValue: true } }).lines.map((l) => l.text);
  assert.ok(high.includes('High value · check the match. Click to pick it in the scanner'), JSON.stringify(high));
  assert.ok(!JSON.stringify(high).includes('Tap'));
});

test('11.3: the first-scan legend is two lines of colored keys inside the width given, with a close box', () => {
  const m = (t) => String(t).length * 7;
  const legend = plainJson(pure.legendLayout(m, 1000));
  const text = legend.lines.map((line) => line.map((p) => p.text).join('')).join('\n');
  assert.match(text, /Green: priced · Amber: pick the card · Blue: pick a version · Grey: not read\./);
  assert.match(text, /Hover a card for its name, click it to open it\./);
  assert.equal(legend.lines.length, 2);
  assert.ok(legend.w <= 1000 && legend.close.x + legend.close.w <= legend.w && legend.close.w >= 20);
  // A narrow page wraps the keys onto more lines instead of running off it.
  const narrow = plainJson(pure.legendLayout(m, 320));
  assert.ok(narrow.lines.length > 2 && narrow.w <= 320, JSON.stringify(narrow.w));
  for (const line of narrow.lines) assert.ok(line.every((p) => p.x + m(p.text) <= narrow.close.x), 'text stays clear of the close box');
});

test('11.3: the legend goes above the photo when there is room, else below it, else inside it', () => {
  const size = { w: 500, h: 56 };
  const view = { w: 1200, h: 900 };
  const place = (photo, avoidTop) => plainJson(pure.legendPlacement(size, photo, view, avoidTop));
  // Room above: its bottom edge is 6 px over the photo's top edge, centered on the photo.
  const above = place({ x1: 100, y1: 200, x2: 900, y2: 700 });
  assert.deepEqual(above, { x: 250, y: 138, where: 'above' });
  // No room above, room below: 6 px under the photo's bottom edge.
  const below = place({ x1: 100, y1: 30, x2: 900, y2: 500 });
  assert.deepEqual(below, { x: 250, y: 506, where: 'below' });
  // Neither: inside the photo, near its top.
  const inside = place({ x1: 0, y1: 0, x2: 1200, y2: 900 });
  assert.equal(inside.where, 'inside');
  assert.equal(inside.y, 4);
  // Never off the page sideways.
  assert.equal(place({ x1: 0, y1: 200, x2: 100, y2: 700 }).x, 4);
  assert.equal(place({ x1: 1100, y1: 200, x2: 1200, y2: 700 }).x, 1200 - 500 - 4);
  // Something above the photo (the full-size pill) is cleared too: the legend goes above that.
  assert.deepEqual(place({ x1: 100, y1: 200, x2: 900, y2: 700 }, 150), { x: 250, y: 88, where: 'above' });
  // With the pill and no room above it, below the photo.
  assert.equal(place({ x1: 100, y1: 90, x2: 900, y2: 500 }, 40).where, 'below');
  // Inside, the legend sits under the pill when there is one.
  assert.equal(plainJson(pure.legendPlacement(size, { x1: 0, y1: 0, x2: 1200, y2: 900 }, view, 10, 40)).y, 44);
});

test('closeButtonRect centres the X on the top-right corner, kept whole inside the visible clip', () => {
  const R = pure.CLOSE_R;
  const area = { x1: 0, y1: 0, x2: 1000, y2: 800 };
  assert.deepEqual({ ...pure.closeButtonRect([100, 200, 300, 400], area) }, { x: 300 - R, y: 200 - R, w: 2 * R, h: 2 * R });
  // At the clip's top edge and right edge the centre is pulled in so the circle is not cut.
  const top = pure.closeButtonRect([100, 0, 300, 400], area);
  assert.equal(top.y, 1);
  const right = pure.closeButtonRect([100, 200, 1000, 400], area);
  assert.equal(right.x + right.w, 1000 - 1);
  assert.equal(pure.closeButtonRect([100, 200, 300, 400], { x1: 0, y1: 0, x2: 10, y2: 10 }), null);
  assert.equal(pure.closeButtonRect([100, 200, 300, 400], null), null);
});

test('the hover stays on a card while the pointer is on its X, which sticks out past the card box', () => {
  const targets = [{ rect: { x: 10, y: 50, w: 100, h: 140 } }];
  const hover = { target: 0, rect: { x: 12, y: 52, w: 80, h: 30 }, close: { x: 101, y: 41, w: 18, h: 18 } };
  assert.equal(pure.hoveredTarget(targets, hover, { x: 112, y: 45 }), 0);
  assert.equal(pure.hoveredTarget(targets, { ...hover, close: null }, { x: 112, y: 45 }), null);
  assert.equal(pure.hoveredTarget(targets, hover, { x: 300, y: 45 }), null);
});
