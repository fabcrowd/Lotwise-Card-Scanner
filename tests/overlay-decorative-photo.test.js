import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { choosePageFocus } from '../tools/extension-wasm/lib/page-focus.js';
import { imageToViewportTransform, mapPhotoBoxToViewport } from '../tools/extension-wasm/photo-detection.js';

// Facebook Marketplace paints the listing photo twice with the same src: the sharp <img> and a blurred, scaled-up
// copy behind it. These tests run content.js against a small fake page whose numbers are the measured ones from
// .tmp/smoke/2026-10-25-overlay-repro/L1-pikachus-binder/geometry.json (viewport 2504x1287, clientWidth 2489).

const rectOf = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y });

const BASE_STYLE = {
  position: 'static', overflowX: 'visible', overflowY: 'visible', filter: 'none', transform: 'none',
  objectFit: 'fill', objectPosition: '50% 50%', backgroundImage: 'none', visibility: 'visible', display: 'block', opacity: '1',
};

function makeNode(tagName, parentElement, style, rect, extra = {}) {
  return {
    tagName, parentElement, style: { ...BASE_STYLE, ...style }, rect,
    previousElementSibling: null, childElementCount: 0, attributes: [], srcset: '', scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect() { return this.rect; },
    getAttribute() { return null; },
    closest() { return null; },
    matches() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...extra,
  };
}

function loadPage({ viewport = { w: 2504, h: 1287 }, clientWidth = 2489, dpr = 1 } = {}) {
  const source = fs.readFileSync(new URL('../tools/extension-wasm/content.js', import.meta.url), 'utf8');
  const html = makeNode('HTML', null, {}, rectOf(0, 0, clientWidth, viewport.h));
  const body = makeNode('BODY', html, {}, rectOf(0, 0, clientWidth, viewport.h));
  const imgs = [];
  const canvases = [];
  let order = [];
  const document = {
    documentElement: Object.assign(html, { clientWidth, clientHeight: viewport.h, appendChild(node) { node.isConnected = true; } }),
    body,
    baseURI: 'https://www.facebook.com/marketplace/item/1787225708972853/',
    getElementById: () => null,
    querySelectorAll: (selector) => (selector === 'img' ? imgs : []),
    createTreeWalker: () => ({ currentNode: null, nextNode: () => null }),
    // Topmost first, like the real call.
    elementsFromPoint: () => order,
    createElement(tag) {
      const style = {};
      const canvas = {
        tagName: tag.toUpperCase(), style, width: 0, height: 0,
        // 100vw laid out in a document that has a scrollbar: the layout viewport is clientWidth wide.
        getBoundingClientRect: () => rectOf(0, 0, clientWidth, viewport.h),
        getContext: () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true }),
        remove() {},
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  const window = {
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame() {},
    innerWidth: viewport.w, innerHeight: viewport.h, devicePixelRatio: dpr, scrollX: 0, scrollY: 0,
  };
  const chrome = { runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve() } };
  vm.runInNewContext(source, {
    window, document, chrome, MutationObserver: class {}, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    getComputedStyle: (el) => el.style, URL, Map, WeakMap, Set,
  });
  return {
    scanner: window.__cardScanner,
    canvases,
    imgs,
    body,
    stackOrder(list) { order = list; },
  };
}

const L1_SRC = 'https://scontent.fluk1-1.fna.fbcdn.net/v/t39.84726-6/800186390_2903927546617956_5838367327249439841_n.jpg?stp=dst-jpg_s960x960_tt6&_nc_cat=108&ccb=1-7&_nc_sid=9';
const L1_FOREGROUND = { x: 908.5, y: 74.47, w: 576, h: 768 };
const L1_BACKDROP = { x: 732.34, y: 37.61, w: 928.3, h: 844.77 };
const L1_SLOT = { x: 774.5, y: 76, w: 844, h: 768 };

function addImg(page, { rect, layout, parent, style = {}, alt = '', src = L1_SRC, natural = [720, 960] }) {
  const img = makeNode('IMG', parent, { objectFit: 'fill', ...style }, rectOf(rect.x, rect.y, rect.w, rect.h), {
    complete: true, naturalWidth: natural[0], naturalHeight: natural[1], currentSrc: src, src, alt,
    offsetWidth: layout ? layout[0] : rect.w, offsetHeight: layout ? layout[1] : rect.h,
  });
  page.imgs.push(img);
  return img;
}

// The measured L1 structure: an overflow:hidden slot holding the sharp photo, and a blurred x11 copy of it.
function facebookListing({ backdropFirst = true, blur = true, scale = true, plainCopy = false } = {}) {
  const page = loadPage();
  const slot = makeNode('DIV', page.body, { overflowX: 'hidden', overflowY: 'hidden' }, rectOf(L1_SLOT.x, L1_SLOT.y, L1_SLOT.w, L1_SLOT.h));
  const backdropBox = makeNode('DIV', slot, {
    filter: blur ? 'blur(2px)' : 'none', transform: scale ? 'matrix(11, 0, 0, 11, 0, 0)' : 'none',
  }, rectOf(L1_BACKDROP.x, L1_BACKDROP.y, L1_BACKDROP.w, L1_BACKDROP.h));
  const wrap = makeNode('DIV', slot, {}, rectOf(L1_FOREGROUND.x, L1_FOREGROUND.y, L1_FOREGROUND.w, 771.08));
  const add = {
    backdrop: () => addImg(page, { rect: L1_BACKDROP, layout: plainCopy ? undefined : [84, 77], parent: backdropBox, style: { objectFit: 'cover' } }),
    foreground: () => addImg(page, { rect: L1_FOREGROUND, parent: wrap, alt: 'Product photo of Pikachus' }),
  };
  if (backdropFirst) { add.backdrop(); add.foreground(); } else { add.foreground(); add.backdrop(); }
  return page;
}

function scan(page) {
  const { cards, photos, rejected } = page.scanner.find({ diag: true });
  const focus = choosePageFocus({ viewport: { w: 2504, h: 1287 }, photos, cards, ogImages: [], headings: [] });
  return { cards, photos, rejected, focus };
}

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test('L1 Facebook photo pair: boxes map onto the foreground picture, not the blurred backdrop (within 1 px)', () => {
  for (const backdropFirst of [true, false]) {
    const { photos, focus } = scan(facebookListing({ backdropFirst }));
    assert.equal(focus.kind, 'listing');
    assert.ok(focus.photos.length >= 1);
    for (const photo of focus.photos) {
      near(photo.rect.x, L1_FOREGROUND.x, 0.01, 'photo x');
      near(photo.rect.w, L1_FOREGROUND.w, 0.01, 'photo w');
    }
    assert.ok(photos.every((p) => Math.abs(p.rect.w - L1_BACKDROP.w) > 1), 'the backdrop is not a photo candidate');

    const main = focus.main;
    const transform = imageToViewportTransform(main.rect, main.naturalWidth, main.naturalHeight, main.render);
    // The whole photo lands on the foreground rect.
    const whole = mapPhotoBoxToViewport([0, 0, 720, 960], transform, main.rect);
    [whole[0], whole[1], whole[2] - whole[0], whole[3] - whole[1]].forEach((v, i) =>
      near(v, [L1_FOREGROUND.x, L1_FOREGROUND.y, L1_FOREGROUND.w, L1_FOREGROUND.h][i], 1, 'whole-photo box'));
    // A card box in photo pixels (a 3x3 binder cell) lands at foreground scale 576/720 = 0.8, unclipped.
    const cell = mapPhotoBoxToViewport([30, 40, 250, 350], transform, main.rect);
    [cell[0], cell[1], cell[2], cell[3]].forEach((v, i) =>
      near(v, [L1_FOREGROUND.x + 24, L1_FOREGROUND.y + 32, L1_FOREGROUND.x + 200, L1_FOREGROUND.y + 280][i], 1, 'card box'));
  }
});

test('the backdrop is reported as decorative in the scan diagnostics', () => {
  const page = facebookListing();
  const { rejected } = scan(page);
  const decorative = rejected.filter((r) => r.reason === 'decorative');
  assert.equal(decorative.length, 1);
  assert.equal(decorative[0].decorative, 'blurred');
});

test('a scaled-up copy with no blur filter is decorative too (painted size inflated by an ancestor transform)', () => {
  const { photos, focus } = scan(facebookListing({ blur: false }));
  assert.equal(focus.kind, 'listing');
  assert.ok(photos.every((p) => Math.abs(p.rect.w - L1_BACKDROP.w) > 1));
  near(focus.main.rect.w, L1_FOREGROUND.w, 0.01, 'main w');
});

test('a blurred copy with no transform is decorative (filter on an ancestor)', () => {
  const { photos, focus } = scan(facebookListing({ scale: false }));
  assert.ok(photos.every((p) => Math.abs(p.rect.w - L1_BACKDROP.w) > 1));
  near(focus.main.rect.w, L1_FOREGROUND.w, 0.01, 'main w');
});

test('two plain copies of one src: the larger one painted fully behind the other is dropped', () => {
  const page = facebookListing({ blur: false, scale: false, plainCopy: true });
  const [backdrop, foreground] = page.imgs;
  page.stackOrder([foreground, backdrop]);
  const { photos, focus } = scan(page);
  assert.ok(photos.every((p) => Math.abs(p.rect.w - L1_BACKDROP.w) > 1), 'the copy behind is dropped');
  near(focus.main.rect.w, L1_FOREGROUND.w, 0.01, 'main w');
});

test('two plain copies of one src, larger one in front: nothing says which is decoration, both stay', () => {
  const page = facebookListing({ blur: false, scale: false, plainCopy: true });
  const [backdrop, foreground] = page.imgs;
  page.stackOrder([backdrop, foreground]);
  const { photos } = scan(page);
  assert.equal(photos.length, 2);
});

test('a single object-fit: cover photo with no blur is still scanned', () => {
  const page = loadPage();
  const slot = makeNode('DIV', page.body, { overflowX: 'hidden', overflowY: 'hidden' }, rectOf(700, 100, 700, 450));
  addImg(page, { rect: { x: 700, y: 100, w: 700, h: 450 }, parent: slot, style: { objectFit: 'cover' }, natural: [1600, 1000], alt: 'Lot of cards' });
  const { photos, focus, rejected } = scan(page);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].render.fit, 'cover');
  assert.equal(focus.kind, 'listing');
  assert.equal(rejected.filter((r) => r.reason === 'decorative').length, 0);
});

test('a photo with a hover zoom (1.2x) or a tilt is not mistaken for a decorative copy', () => {
  const page = loadPage();
  const zoomed = makeNode('DIV', page.body, { transform: 'matrix(1.2, 0, 0, 1.2, 0, 0)' }, rectOf(700, 100, 600, 450));
  addImg(page, { rect: { x: 700, y: 100, w: 600, h: 450 }, layout: [500, 375], parent: zoomed, natural: [1600, 1200] });
  assert.equal(scan(page).photos.length, 1);
});

test('decorativeReason and hasBlur on the measured L1 numbers', () => {
  const { pure } = loadPage().scanner;
  assert.equal(pure.hasBlur('blur(2px)'), true);
  assert.equal(pure.hasBlur('brightness(0.8) blur(3px)'), true);
  assert.equal(pure.hasBlur('blur(0px)'), false);
  assert.equal(pure.hasBlur('none'), false);
  assert.equal(pure.hasBlur(undefined), false);
  const backdrop = { rect: { w: 928.3, h: 844.77 }, layoutW: 84, layoutH: 77 };
  assert.equal(pure.decorativeReason({ ...backdrop, blurred: true }), 'blurred');
  assert.equal(pure.decorativeReason({ ...backdrop, blurred: false }), 'inflated');
  assert.equal(pure.decorativeReason({ rect: { w: 576, h: 768 }, layoutW: 576, layoutH: 768, blurred: false }), null);
  assert.equal(pure.decorativeReason({ rect: { w: 576, h: 768 }, layoutW: 576, layoutH: 768, blurred: false, behindDuplicate: true }), 'behind-duplicate');
  // No layout size known (offsetWidth 0, e.g. an SVG image): never called inflated.
  assert.equal(pure.decorativeReason({ rect: { w: 576, h: 768 }, layoutW: 0, layoutH: 0, blurred: false }), null);
  // A tilt of 45 degrees grows the bounding box by 1.41x at most.
  assert.equal(pure.decorativeReason({ rect: { w: 566, h: 566 }, layoutW: 400, layoutH: 400, blurred: false }), null);
});

test('overlay canvas backing store matches its CSS width x dpr when a scrollbar narrows the page', () => {
  const { pure } = loadPage().scanner;
  // 2489 CSS px wide (100vw laid out beside a 15 px scrollbar) while innerWidth reports 2504.
  assert.deepEqual({ ...pure.canvasBacking(2489, 1287, 1) }, { width: 2489, height: 1287 });
  assert.deepEqual({ ...pure.canvasBacking(2489, 1287, 1.5) }, { width: 3734, height: 1931 });
  assert.deepEqual({ ...pure.canvasBacking(1100.4, 700.4, 2) }, { width: 2201, height: 1401 });
});

for (const dpr of [1, 1.5]) {
  test(`rendering the overlay sizes the canvas bitmap from its CSS size, not innerWidth (dpr ${dpr})`, () => {
    const page = loadPage({ dpr });
    page.scanner.show([], 2504, 1287);
    const canvas = page.canvases.at(-1);
    assert.equal(canvas.width, Math.round(2489 * dpr));
    assert.equal(canvas.height, Math.round(1287 * dpr));
  });
}
