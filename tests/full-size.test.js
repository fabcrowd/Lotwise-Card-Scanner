import assert from 'node:assert/strict';
import test from 'node:test';
import { facebookOriginal, fullSizeCandidates, isFacebookCdn, loadFullSize, sameAspect } from '../tools/extension-wasm/lib/full-size.js';
import { imageToViewportTransform, mapPhotoBoxToViewport, rescaleTransform } from '../tools/extension-wasm/photo-detection.js';

const BASE = 'https://shop.example/item/1';

test('an eBay thumbnail is rewritten to the 1600 rendition, other hints follow', () => {
  const urls = fullSizeCandidates({
    src: 'https://i.ebayimg.com/images/g/AbC/s-l300.jpg',
    naturalWidth: 234,
    base: BASE,
  });
  assert.equal(urls[0], 'https://i.ebayimg.com/images/g/AbC/s-l1600.jpg');
  assert.equal(urls.includes('https://i.ebayimg.com/images/g/AbC/s-l300.jpg'), false);
});

test('an eBay image already at 1600 is not rewritten', () => {
  assert.deepEqual(fullSizeCandidates({ src: 'https://i.ebayimg.com/images/g/AbC/s-l1600.webp', naturalWidth: 900, base: BASE }), []);
});

test('srcset entries are ordered by width and smaller-than-displayed ones are dropped', () => {
  const urls = fullSizeCandidates({
    src: 'https://cdn.example/p/a-300.jpg',
    naturalWidth: 300,
    srcset: 'https://cdn.example/p/a-300.jpg 300w, https://cdn.example/p/a-900.jpg 900w, /p/a-600.jpg 600w, https://cdn.example/p/a-200.jpg 200w',
    base: BASE,
  });
  assert.deepEqual(urls, ['https://cdn.example/p/a-900.jpg', 'https://shop.example/p/a-600.jpg']);
});

test('x descriptors are understood', () => {
  const urls = fullSizeCandidates({
    src: 'https://cdn.example/a.jpg',
    naturalWidth: 400,
    srcset: 'https://cdn.example/a.jpg 1x, https://cdn.example/a@3x.jpg 3x, https://cdn.example/a@2x.jpg 2x',
    base: BASE,
  });
  assert.deepEqual(urls, ['https://cdn.example/a@3x.jpg', 'https://cdn.example/a@2x.jpg']);
});

test('zoom attributes and an image link are candidates; a page link and og:image of another picture are not', () => {
  const urls = fullSizeCandidates({
    src: 'https://cdn.example/t/thumb.jpg',
    naturalWidth: 200,
    attrs: ['https://cdn.example/t/zoom.jpg', '//cdn.example/t/large.png', 'not a url', 'javascript:alert(1)'],
    link: 'https://cdn.example/t/big.jpeg?x=1',
    ogImages: ['https://cdn.example/other/cover.jpg'],
    base: BASE,
  });
  assert.deepEqual(urls, ['https://cdn.example/t/zoom.jpg', 'https://cdn.example/t/large.png', 'https://cdn.example/t/big.jpeg?x=1']);
  assert.deepEqual(fullSizeCandidates({ src: 'https://cdn.example/t/thumb.jpg', naturalWidth: 200, link: 'https://shop.example/item/2', base: BASE }), []);
});

test('og:image counts only when it is the same picture at another size', () => {
  const urls = fullSizeCandidates({
    src: 'https://cdn.example/p/card_300x400.jpg',
    naturalWidth: 300,
    ogImages: ['https://cdn.example/p/card_1200x1600.jpg', 'https://cdn.example/p/different.jpg'],
    base: BASE,
  });
  assert.equal(urls.includes('https://cdn.example/p/card_1200x1600.jpg'), true);
  assert.equal(urls.includes('https://cdn.example/p/different.jpg'), false);
});

test('size suffixes and width parameters are rewritten', () => {
  assert.equal(fullSizeCandidates({ src: 'https://blog.example/wp/card-300x420.jpg', naturalWidth: 300, base: BASE })[0],
    'https://blog.example/wp/card.jpg');
  assert.equal(fullSizeCandidates({ src: 'https://cdn.example/card_240x.jpg', naturalWidth: 240, base: BASE })[0],
    'https://cdn.example/card.jpg');
  assert.equal(fullSizeCandidates({ src: 'https://img.example/a.jpg?w=300&auto=format', naturalWidth: 300, base: BASE })[0],
    'https://img.example/a.jpg?w=1600&auto=format');
  assert.equal(fullSizeCandidates({ src: 'https://img.example/a.jpg?width=300&height=400', naturalWidth: 300, base: BASE })[0],
    'https://img.example/a.jpg?width=1600&height=2133');
});

test('only https URLs on hosts the page itself named are produced', () => {
  const urls = fullSizeCandidates({
    src: 'http://insecure.example/a-300.jpg',
    naturalWidth: 300,
    srcset: 'http://insecure.example/a-900.jpg 900w, https://ok.example/a-900.jpg 900w, ftp://x.example/a.jpg 1200w',
    attrs: ['http://insecure.example/zoom.jpg', 'https://user:pw@ok.example/zoom.jpg', 'data:image/png;base64,AAAA'],
    base: BASE,
  });
  assert.deepEqual(urls, ['https://ok.example/a-900.jpg']);
});

test('duplicates collapse and the displayed URL is never returned', () => {
  const urls = fullSizeCandidates({
    src: 'https://i.ebayimg.com/images/g/X/s-l500.jpg',
    currentSrc: 'https://i.ebayimg.com/images/g/X/s-l500.jpg',
    naturalWidth: 400,
    srcset: 'https://i.ebayimg.com/images/g/X/s-l1600.jpg 1600w',
    attrs: ['https://i.ebayimg.com/images/g/X/s-l1600.jpg'],
    base: BASE,
  });
  assert.deepEqual(urls, ['https://i.ebayimg.com/images/g/X/s-l1600.jpg']);
});

test('garbage input yields no candidates', () => {
  assert.deepEqual(fullSizeCandidates({}), []);
  assert.deepEqual(fullSizeCandidates({ src: '', srcset: ',,', attrs: [null, 5] }), []);
});

test('sameAspect allows about 3 percent', () => {
  assert.equal(sameAspect({ width: 234, height: 300 }, { width: 1600, height: 2051 }), true);
  assert.equal(sameAspect({ width: 234, height: 300 }, { width: 1600, height: 1600 }), false);
  assert.equal(sameAspect({ width: 234, height: 300 }, { width: 1600, height: 2200 }), false);
  assert.equal(sameAspect({ width: 0, height: 300 }, { width: 10, height: 10 }), false);
});

const bitmap = (width, height, log = []) => ({ width, height, close: () => log.push(`close ${width}x${height}`) });

test('loadFullSize takes the first candidate that is larger and has the same shape', async () => {
  const closed = [];
  const tried = [];
  const sources = {
    a: null,
    b: bitmap(1000, 1000, closed),
    c: bitmap(234, 300, closed),
    d: bitmap(1600, 2050, closed),
    e: bitmap(2000, 2564, closed),
  };
  const got = await loadFullSize(['a', 'b', 'c', 'd', 'e'], { width: 234, height: 300 }, async (url) => {
    tried.push(url);
    return sources[url];
  });
  assert.equal(got.url, 'd');
  assert.equal(got.bitmap.width, 1600);
  assert.deepEqual(tried, ['a', 'b', 'c', 'd']);
  assert.deepEqual(closed, ['close 1000x1000', 'close 234x300']);
});

test('loadFullSize survives a loader that throws and returns null when nothing fits', async () => {
  const got = await loadFullSize(['a', 'b'], { width: 100, height: 100 }, async (url) => {
    if (url === 'a') throw new Error('network');
    return null;
  });
  assert.equal(got, null);
  assert.equal(await loadFullSize([], { width: 100, height: 100 }, async () => bitmap(500, 500)), null);
  assert.equal(await loadFullSize(['a'], { width: 0, height: 0 }, async () => bitmap(500, 500)), null);
});

test('boxes found in an upgraded image land where the same box would in the displayed one', () => {
  const rect = { x: 100, y: 50, w: 234, h: 300 };
  const shown = imageToViewportTransform(rect, 234, 300, { fit: 'fill', position: '50% 50%' });
  const upgraded = rescaleTransform(shown, 234 / 1600, 300 / 2051);
  const small = mapPhotoBoxToViewport([10, 20, 110, 160], shown);
  const big = mapPhotoBoxToViewport([10 * 1600 / 234, 20 * 2051 / 300, 110 * 1600 / 234, 160 * 2051 / 300], upgraded);
  small.forEach((value, i) => assert.ok(Math.abs(value - big[i]) < 1e-9, `${i}: ${value} vs ${big[i]}`));
});

test('rescaling keeps object-fit none, which is sized by the displayed image, correct', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  const shown = imageToViewportTransform(rect, 234, 300, { fit: 'none', position: '0% 0%' });
  const upgraded = rescaleTransform(shown, 234 / 1600, 300 / 2051);
  const [x1, , x2] = mapPhotoBoxToViewport([0, 0, 1600, 2051], upgraded);
  assert.ok(Math.abs(x1) < 1e-9 && Math.abs(x2 - 234) < 1e-9, `${x1} ${x2}`);
  assert.equal(rescaleTransform(null, 1, 1), null);
});

test('candidates on a host the page never loaded images from are dropped', () => {
  const hints = {
    src: 'https://cdn.example/p/a-300.jpg',
    naturalWidth: 300,
    srcset: 'https://cdn.example/p/a-900.jpg 900w, https://evil.example/a-1200.jpg 1200w',
    attrs: ['https://other.example/zoom.jpg'],
    base: BASE,
  };
  assert.deepEqual(fullSizeCandidates({ ...hints, allowedHosts: new Set(['cdn.example']) }), ['https://cdn.example/p/a-900.jpg']);
  assert.deepEqual(fullSizeCandidates({ ...hints, allowedHosts: ['CDN.example', 'other.example'] }),
    ['https://other.example/zoom.jpg', 'https://cdn.example/p/a-900.jpg']);
  assert.deepEqual(fullSizeCandidates({ ...hints, allowedHosts: new Set() }), []);
});

test('a rewritten thumbnail stays on its own host, so it passes when that host is allowed', () => {
  const src = 'https://i.ebayimg.com/images/g/AbC/s-l300.jpg';
  assert.equal(fullSizeCandidates({ src, naturalWidth: 234, base: BASE, allowedHosts: new Set(['i.ebayimg.com']) })[0], 'https://i.ebayimg.com/images/g/AbC/s-l1600.jpg');
  assert.deepEqual(fullSizeCandidates({ src, naturalWidth: 234, base: BASE, allowedHosts: new Set(['cdn.example']) }), []);
});

const FB_OG = 'https://scontent-xx1-1.xx.fbcdn.net/v/t39.0-6/100000001_2000000000000002_3000000000000000003_n.jpg?stp=dst-jpg_tt6&cstp=mx1537x2048&ctp=p600x600&_nc_cat=107&oh=00_AAA&oe=00000000';
const FB_SHOWN = 'https://scontent-xx1-1.xx.fbcdn.net/v/t39.0-6/100000001_2000000000000002_3000000000000000003_n.jpg?stp=dst-jpg_s960x960_tt6&_nc_cat=107&oh=00_BBB&oe=00000000';
const FB_ORIGINAL = 'https://scontent-xx1-1.xx.fbcdn.net/v/t39.0-6/100000001_2000000000000002_3000000000000000003_n.jpg?stp=dst-jpg_tt6&cstp=mx1537x2048&_nc_cat=107&oh=00_AAA&oe=00000000';

test('facebookOriginal drops only the ctp resize, and only on the Facebook CDN', () => {
  assert.equal(facebookOriginal(FB_OG), FB_ORIGINAL);
  assert.equal(facebookOriginal(FB_SHOWN), null);
  assert.equal(facebookOriginal('https://cdn.example/a.jpg?ctp=p600x600'), null);
  assert.equal(facebookOriginal('https://fbcdn.net.evil.example/a.jpg?ctp=p600x600'), null);
  assert.equal(facebookOriginal('http://scontent.xx.fbcdn.net/a.jpg?ctp=p600x600'), null);
  assert.equal(facebookOriginal('not a url'), null);
  assert.equal(isFacebookCdn('scontent-iad3-2.xx.fbcdn.net'), true);
  assert.equal(isFacebookCdn('fbcdn.net.example'), false);
});

test('the Facebook original of the shown photo comes first, from its og:image', () => {
  const urls = fullSizeCandidates({ src: FB_SHOWN, naturalWidth: 720, ogImages: [FB_OG], base: 'https://www.facebook.com/marketplace/item/1/',
    allowedHosts: new Set(['scontent-iad3-1.xx.fbcdn.net']) });
  assert.equal(urls[0], FB_ORIGINAL);
  assert.equal(urls.includes(FB_SHOWN), false);
});

test('an og:image of another Facebook photo, or from another CDN, is not used', () => {
  const other = FB_OG.replace('100000001_', '100000009_');
  assert.deepEqual(fullSizeCandidates({ src: FB_SHOWN, naturalWidth: 720, ogImages: [other], base: BASE }), []);
  const urls = fullSizeCandidates({ src: FB_SHOWN, naturalWidth: 720, ogImages: [FB_OG], base: BASE, allowedHosts: new Set(['cdn.example']) });
  assert.deepEqual(urls, []);
});

test('a failed or same-size Facebook original falls back to the next candidate', async () => {
  const seen = [];
  const found = await loadFullSize([FB_ORIGINAL, 'https://cdn.example/b.jpg'], { width: 720, height: 960 }, async (url) => {
    seen.push(url);
    return url === FB_ORIGINAL ? null : { width: 1440, height: 1920 };
  });
  assert.deepEqual(seen, [FB_ORIGINAL, 'https://cdn.example/b.jpg']);
  assert.equal(found.url, 'https://cdn.example/b.jpg');
});

// D5 note (gate 2, L1): reading the Facebook original (1537x2048) instead of the served 720x960 made the Detective
// Pikachu box worse (IoU 0.768 -> 0.582). The mapping is not the cause: the same box in either picture lands on the
// same viewport rect (the original's 1537/2048 shape differs from 720/960 by under half a pixel here), so the wider
// box is the detector's own output on the original's pixels.
test('a box read from the Facebook original maps to the viewport exactly as the served copy\'s box does (L1)', () => {
  const rect = { x: 908.5, y: 74.47, w: 576, h: 768 };
  const served = imageToViewportTransform(rect, 720, 960, { fit: 'contain', position: '50% 50%' });
  const original = rescaleTransform(served, 720 / 1537, 960 / 2048);
  // The gate 1 Detective Pikachu card edges, in served pixels.
  const box = [249.4, 109.6, 463.1, 415.7];
  const fromServed = mapPhotoBoxToViewport(box, served);
  const fromOriginal = mapPhotoBoxToViewport([box[0] * 1537 / 720, box[1] * 2048 / 960, box[2] * 1537 / 720, box[3] * 2048 / 960], original);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(fromServed[i] - fromOriginal[i]) < 0.5, `edge ${i}: ${fromServed[i]} vs ${fromOriginal[i]}`);
  // A box as wide as the gate 2 one (686x746 in the original) stays that wide on screen: the mapping cannot widen it.
  const wide = mapPhotoBoxToViewport([305, 159, 991, 905], original);
  assert.ok(Math.abs((wide[2] - wide[0]) - 686 * 576 / 1537) < 0.01);
});
