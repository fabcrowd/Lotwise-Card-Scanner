import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAWN_VIA, MIN_DRAW_SIDE, REPLACE_IOU,
  acceptDrawnSender, correctionSource, examGroupAllowed, examHoldAllowed, drawnCardEntry, drawnIndices, iou, isSameLot, isSamePage, normalizeDrawnMessage, placeDrawnCard, restoredLotTabId,
  viewportRectToBitmapBox, viewportToPhotoBox,
} from '../tools/extension-wasm/lib/draw-box.js';
import { correctionRecord } from '../tools/extension-wasm/lib/card-picker.js';
import { imageToViewportTransform, mapPhotoBoxToViewport, rescaleTransform } from '../tools/extension-wasm/photo-detection.js';
import { notCardEntry } from '../tools/extension-wasm/lib/not-card.js';
import { tooSmallCard } from '../tools/extension-wasm/lib/tiny-card.js';

const close = (actual, expected, eps = 1e-6) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= eps, `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`));
};

// The inverse of what the scan does: a viewport rectangle back to photo pixels.
test('fill: a viewport rectangle maps to photo pixels by the scale and offset', () => {
  const rect = { x: 100, y: 50, w: 400, h: 300 };
  const transform = imageToViewportTransform(rect, 800, 600, { fit: 'fill' });
  close(viewportToPhotoBox([200, 100, 300, 200], transform, { width: 800, height: 600 }), [200, 100, 400, 300]);
});

test('contain (letterbox): the bars are skipped and the box lands on the picture', () => {
  const rect = { x: 100, y: 50, w: 400, h: 300 };
  const transform = imageToViewportTransform(rect, 800, 800, { fit: 'contain' }); // 300x300 shown at left 150
  close(viewportToPhotoBox([200, 100, 300, 200], transform, { width: 800, height: 800 }), [50 / 0.375, 50 / 0.375, 150 / 0.375, 150 / 0.375]);
});

test('a box drawn partly over the letterbox bar is clipped to the picture', () => {
  const rect = { x: 100, y: 50, w: 400, h: 300 };
  const transform = imageToViewportTransform(rect, 800, 800, { fit: 'contain' });
  close(viewportToPhotoBox([110, 100, 300, 200], transform, { width: 800, height: 800 }), [0, 50 / 0.375, 150 / 0.375, 150 / 0.375]);
});

test('cover: the cropped part is clamped to the picture', () => {
  const rect = { x: 0, y: 0, w: 400, h: 300 };
  const transform = imageToViewportTransform(rect, 800, 800, { fit: 'cover' }); // scale 0.5, shown 400x400 at top -50
  close(viewportToPhotoBox([0, 0, 200, 100], transform, { width: 800, height: 800 }), [0, 100, 400, 300]);
});

test('a scaled picture (a small natural size shown large) maps back through its own scale', () => {
  const rect = { x: 10, y: 20, w: 1000, h: 500 };
  const transform = imageToViewportTransform(rect, 250, 125, { fit: 'fill' }); // scale 4
  close(viewportToPhotoBox([110, 120, 210, 220], transform, { width: 250, height: 125 }), [25, 25, 50, 50]);
});

test('an upgraded (larger) source reads the same place in its own pixels', () => {
  const rect = { x: 0, y: 0, w: 400, h: 300 };
  const shown = imageToViewportTransform(rect, 400, 300, { fit: 'fill' });
  const upgraded = rescaleTransform(shown, 400 / 1600, 300 / 1200); // the source is 1600x1200
  close(viewportToPhotoBox([100, 75, 200, 150], upgraded, { width: 1600, height: 1200 }), [400, 300, 800, 600]);
});

test('scroll offset: a photo partly above the viewport keeps the box on the right pixels', () => {
  const rect = { x: 0, y: -200, w: 400, h: 600 }; // scrolled 200 px down
  const transform = imageToViewportTransform(rect, 400, 600, { fit: 'fill' });
  close(viewportToPhotoBox([50, 10, 150, 110], transform, { width: 400, height: 600 }), [50, 210, 150, 310]);
});

test('round trip: mapping the photo box forward gives the drawn rectangle back', () => {
  const rect = { x: 37, y: 91, w: 513, h: 377 };
  for (const fit of ['fill', 'contain', 'cover', 'scale-down']) {
    const transform = imageToViewportTransform(rect, 1280, 960, { fit, position: '50% 50%' });
    const drawn = [140, 150, 290, 300];
    const photo = viewportToPhotoBox(drawn, transform, { width: 1280, height: 960 });
    const back = mapPhotoBoxToViewport(photo, transform, rect);
    close(back, drawn, 1e-6);
  }
});

test('an unusable transform or an empty overlap gives no box', () => {
  assert.equal(viewportToPhotoBox([0, 0, 10, 10], null, { width: 10, height: 10 }), null);
  const transform = imageToViewportTransform({ x: 0, y: 0, w: 100, h: 100 }, 100, 100, { fit: 'fill' });
  assert.equal(viewportToPhotoBox([200, 200, 300, 300], transform, { width: 100, height: 100 }), null);
});

test('screenshot fallback: viewport CSS px scale by the measured ratio and clamp to the bitmap', () => {
  close(viewportRectToBitmapBox([10, 20, 110, 220], 1.5, { width: 1500, height: 1000 }), [15, 30, 165, 330]);
  close(viewportRectToBitmapBox([900, 600, 1100, 800], 1.5, { width: 1500, height: 1000 }), [1350, 900, 1500, 1000]);
  assert.equal(viewportRectToBitmapBox([2000, 0, 2100, 10], 1, { width: 1500, height: 1000 }), null);
});

test('IoU of two boxes', () => {
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(iou([0, 0, 10, 10], [20, 20, 30, 30]), 0);
  assert.ok(Math.abs(iou([0, 0, 10, 10], [5, 0, 15, 10]) - 1 / 3) < 1e-9);
});

// The result entry.
test('a read drawn box is a normal card marked drawn: not shared, not confirmed on its own', () => {
  const read = { identity: { id: 'base1-4', name: 'Charizard' }, confidence: 0.9, abstain: false, unsure: true, market_price: null, price_variant: null, price_grid: null };
  const entry = drawnCardEntry({ box: [10, 20, 110, 160], read, readHeight: 140, crop: 'data:image/jpeg;base64,xx' });
  assert.equal(entry.drawn, true);
  assert.equal(entry.via, DRAWN_VIA);
  assert.equal(entry.via, 'drawn');
  assert.equal(entry.share, null);
  assert.deepEqual(entry.box, [10, 20, 110, 160]);
  assert.equal(entry.identity.name, 'Charizard');
  assert.equal(entry.unsure, true);
  for (const key of ['userConfirmed', 'setConfirmed', 'skipped', 'notCard', 'tooSmall']) assert.ok(!(key in entry), key);
  assert.equal(entry.crop, 'data:image/jpeg;base64,xx');
});

test('drawing never adds a confirmation the read did not have', () => {
  const read = { identity: { name: 'X' }, confidence: 0.5, abstain: false, unsure: true };
  assert.ok(!('userConfirmed' in drawnCardEntry({ box: [0, 0, 50, 70], read, readHeight: 70 })));
});

test('a drawn box under the read gate is a Too small entry, still marked drawn and not shared', () => {
  const entry = drawnCardEntry({ box: [0, 0, 30, 40], tooSmall: true, readHeight: 40 });
  assert.equal(entry.tooSmall, true);
  assert.equal(entry.cardBack, true);
  assert.equal(entry.identity, null);
  assert.equal(entry.drawn, true);
  assert.equal(entry.via, 'drawn');
  assert.equal(entry.share, null);
  assert.ok(!('notCard' in entry));
});

// Placing it in the result.
const read = (box) => ({ box, identity: { name: 'A' }, confidence: 0.9, abstain: false });

test('with no result yet the card starts a one-card result', () => {
  const placed = placeDrawnCard([], drawnCardEntry({ box: [0, 0, 100, 140], tooSmall: false, read: read(null), readHeight: 140 }));
  assert.equal(placed.cards.length, 1);
  assert.equal(placed.index, 0);
  assert.equal(placed.replaced, false);
});

test('it is appended with the next row number when nothing overlaps', () => {
  const cards = [read([0, 0, 100, 140]), read([200, 0, 300, 140])];
  const placed = placeDrawnCard(cards, drawnCardEntry({ box: [400, 0, 500, 140], read: read(null), readHeight: 140 }));
  assert.equal(placed.index, 2);
  assert.equal(placed.cards.length, 3);
  assert.equal(placed.replaced, false);
  assert.equal(cards.length, 2, 'the input list is not changed');
});

test('it replaces a hidden not-a-card entry it overlaps at IoU >= 0.3', () => {
  const hidden = notCardEntry({ box: [0, 0, 100, 140], score: 0.4, readHeight: 140, via: 'yolo-in-photo', unread: true });
  const cards = [read([200, 0, 300, 140]), hidden];
  const placed = placeDrawnCard(cards, drawnCardEntry({ box: [5, 5, 105, 145], read: read(null), readHeight: 140 }));
  assert.equal(placed.index, 1);
  assert.equal(placed.replaced, true);
  assert.equal(placed.cards.length, 2);
  assert.equal(placed.cards[1].drawn, true);
  assert.ok(!placed.cards[1].notCard);
});

test('it replaces a Too small entry for the same place', () => {
  const small = tooSmallCard({ box: [0, 0, 30, 45], score: 0.5, readHeight: 45, via: 'yolo-in-photo' });
  const placed = placeDrawnCard([small], drawnCardEntry({ box: [0, 0, 36, 50], read: read(null), readHeight: 50 }));
  assert.equal(placed.index, 0);
  assert.equal(placed.replaced, true);
});

test('below the overlap threshold it is appended, and a real read card is never replaced', () => {
  const hidden = notCardEntry({ box: [0, 0, 100, 140], score: 0.4, readHeight: 140, unread: true });
  const far = placeDrawnCard([hidden], drawnCardEntry({ box: [90, 0, 190, 140], read: read(null), readHeight: 140 }));
  assert.equal(far.replaced, false);
  assert.equal(far.cards.length, 2);
  const over = placeDrawnCard([read([0, 0, 100, 140])], drawnCardEntry({ box: [0, 0, 100, 140], read: read(null), readHeight: 140 }));
  assert.equal(over.replaced, false);
  assert.equal(over.cards.length, 2);
  assert.equal(REPLACE_IOU, 0.3);
});

test('the best-overlapping of several hidden entries is the one replaced', () => {
  const a = notCardEntry({ box: [0, 0, 100, 140], score: 0.4, readHeight: 140, unread: true });
  const b = notCardEntry({ box: [20, 0, 120, 140], score: 0.4, readHeight: 140, unread: true });
  const placed = placeDrawnCard([a, b], drawnCardEntry({ box: [22, 0, 122, 140], read: read(null), readHeight: 140 }));
  assert.equal(placed.index, 1);
});

test('a hidden entry read from another photo of the gallery is not on the page and is not replaced', () => {
  const hidden = notCardEntry({ box: [0, 0, 100, 140], score: 0.4, readHeight: 140, unread: true, photo: 2, inGallery: true });
  const placed = placeDrawnCard([hidden], drawnCardEntry({ box: [0, 0, 100, 140], read: read(null), readHeight: 140 }));
  assert.equal(placed.replaced, false);
});

test('document boxes decide the overlap when both entries have them (the page was scrolled since the scan)', () => {
  const hidden = notCardEntry({ box: [0, 0, 100, 140], docBox: [0, 600, 100, 740], score: 0.4, readHeight: 140, unread: true });
  const scrolled = placeDrawnCard([hidden], drawnCardEntry({ box: [0, 0, 100, 140], docBox: [0, 600, 100, 740], read: read(null), readHeight: 140 }));
  assert.equal(scrolled.replaced, true);
  const elsewhere = placeDrawnCard([hidden], drawnCardEntry({ box: [0, 0, 100, 140], docBox: [0, 0, 100, 140], read: read(null), readHeight: 140 }));
  assert.equal(elsewhere.replaced, false);
});

test('scanned cards with a docBox pick the right hidden entry after the page was scrolled (viewport boxes would pick wrong)', () => {
  // Scanned at scroll 0: A at doc y 0, B at doc y 300. The user scrolls 300, then draws where B is: viewport [0,0,100,140].
  const a = notCardEntry({ box: [0, 0, 100, 140], docBox: [0, 0, 100, 140], score: 0.4, readHeight: 140, unread: true });
  const b = notCardEntry({ box: [0, 300, 100, 440], docBox: [0, 300, 100, 440], score: 0.4, readHeight: 140, unread: true });
  const drawn = drawnCardEntry({ box: [0, 0, 100, 140], docBox: [0, 300, 100, 440], read: read(null), readHeight: 140 });
  const placed = placeDrawnCard([a, b], drawn);
  assert.equal(placed.replaced, true);
  assert.equal(placed.index, 1);
  const wrong = placeDrawnCard([{ ...a, docBox: undefined }, { ...b, docBox: undefined }], drawn);
  assert.equal(wrong.index, 0); // without docBoxes the viewport boxes pick the wrong entry
});

test('isSameLot: same page and same tab, or an unknown tab id falls back to the page alone', () => {
  const url = 'https://x.test/a#top';
  assert.equal(isSameLot({ url, tabId: 5 }, { url: 'https://x.test/a', tabId: 5 }), true);
  assert.equal(isSameLot({ url, tabId: 5 }, { url, tabId: 6 }), false);
  assert.equal(isSameLot({ url, tabId: undefined }, { url, tabId: 6 }), true);
  assert.equal(isSameLot({ url, tabId: 5 }, { url, tabId: null }), true);
  assert.equal(isSameLot({ url, tabId: 5 }, { url: 'https://x.test/b', tabId: 5 }), false);
  assert.equal(isSameLot({ url: null, tabId: 5 }, { url, tabId: 5 }), false);
  assert.equal(isSameLot(null, { url, tabId: 5 }), false);
});

test('a lot restored for tab 42 keeps a box drawn in tab 42 and not one drawn in tab 17 (the tab it was saved from)', () => {
  const url = 'https://x.test/a';
  const lotTab = restoredLotTabId({ tabUrl: url, tabId: 42 });
  assert.equal(lotTab, 42);
  assert.equal(isSameLot({ url, tabId: lotTab }, { url, tabId: 42 }), true);
  assert.equal(isSameLot({ url, tabId: lotTab }, { url, tabId: 17 }), false);
  assert.equal(restoredLotTabId({ tabUrl: url }), null);
  assert.equal(restoredLotTabId({ tabId: 'x' }), null);
  assert.equal(restoredLotTabId(null), null);
  assert.equal(isSameLot({ url, tabId: restoredLotTabId({}) }, { url, tabId: 17 }), true);
});

// The message the page sends.
const photo = () => ({ rect: { x: 0, y: 0, w: 400, h: 300, vx: 0, vy: 0, vw: 400, vh: 300 }, naturalWidth: 800, naturalHeight: 600, src: 'https://x.test/a.jpg', render: { fit: 'fill', position: '50% 50%' } });

test('a good message is accepted and a drawn box under the minimum side or off any photo is not', () => {
  const good = normalizeDrawnMessage({ photo: photo(), drawn: [10, 10, 110, 150], viewportWidth: 800, viewportHeight: 600, devicePixelRatio: 2 });
  assert.deepEqual(good.drawn, [10, 10, 110, 150]);
  assert.equal(good.devicePixelRatio, 2);
  assert.deepEqual(good.scroll, { x: 0, y: 0 });
  assert.deepEqual(normalizeDrawnMessage({ photo: photo(), drawn: [10, 10, 110, 150], scrollX: 5, scrollY: 300 }).scroll, { x: 5, y: 300 });
  assert.equal(normalizeDrawnMessage({ photo: photo(), drawn: [10, 10, 10 + MIN_DRAW_SIDE - 1, 150], viewportWidth: 800, viewportHeight: 600 }), null);
  assert.equal(normalizeDrawnMessage({ drawn: [10, 10, 110, 150] }), null);
  assert.equal(normalizeDrawnMessage({ photo: photo(), drawn: [10, 10, 'x', 150] }), null);
  assert.equal(normalizeDrawnMessage(null), null);
});

// A drawn row placed at index i stands for a different picture than the scan's crops[i] and shares[i].
const OLD_CROP = 'data:image/jpeg;base64,OLD';
const DRAWN_CROP = 'data:image/jpeg;base64,DRAWN';
const teachShare = { photoId: 'p1', split: 'teach', box: [0, 0, 1, 1], scanner: {} };

test('replacing a hidden row then correcting it stores the drawn crop, not the old box crop', () => {
  const hidden = notCardEntry({ box: [0, 0, 100, 140], score: 0.4, readHeight: 140, unread: true });
  const entry = drawnCardEntry({ box: [5, 5, 105, 145], read: read(null), readHeight: 140, crop: DRAWN_CROP });
  const placed = placeDrawnCard([hidden], entry);
  assert.equal(placed.replaced, true);
  const scan = { crops: [OLD_CROP], shares: [teachShare] };
  const source = correctionSource(scan, { index: placed.index, drawn: true, crop: placed.cards[0].crop });
  assert.equal(source.crop, DRAWN_CROP);
  assert.equal(source.share, null, 'a drawn row never carries the old box share');
  const record = correctionRecord({ ts: 1, scanId: 's1', index: placed.index, guess: {}, pickedId: 'base1-4', via: 'candidates', crop: source.crop });
  assert.equal(record.crop, DRAWN_CROP);
});

test('a scanned row still uses the scan crop and share; a drawn row with no usable crop gets none, never the old one', () => {
  const scan = { crops: [OLD_CROP], shares: [teachShare] };
  assert.deepEqual({ ...correctionSource(scan, { index: 0 }) }, { crop: OLD_CROP, share: teachShare });
  assert.equal(correctionSource(scan, { index: 0, drawn: true }).crop, null);
  assert.equal(correctionSource(scan, { index: 0, drawn: true, crop: 'javascript:x' }).crop, null);
  assert.equal(correctionSource(null, { index: 0 }).crop, undefined);
});

test('a drawn row is never queued for the shared exam, and an exam photo holding one is not sent', () => {
  assert.equal(examHoldAllowed({ drawn: true }), false);
  assert.equal(examHoldAllowed({ drawn: false }), true);
  assert.equal(examHoldAllowed({}), true);
  assert.equal(examGroupAllowed([0, 1], [1]), false);
  assert.equal(examGroupAllowed([0, 1], [5]), true);
  assert.equal(examGroupAllowed([0, 1], undefined), true);
});

test('drawnIndices lists the drawn rows', () => {
  assert.deepEqual(drawnIndices([read(null), { drawn: true }, null, { drawn: true }]), [1, 3]);
  assert.deepEqual(drawnIndices(undefined), []);
});

// The result a drawn card joins must be for the same page.
test('isSamePage compares the page, not the hash; no result page is never the same', () => {
  assert.equal(isSamePage('https://a.test/x?y=1#top', 'https://a.test/x?y=1'), true);
  assert.equal(isSamePage('https://a.test/x', 'https://a.test/z'), false);
  assert.equal(isSamePage('https://a.test/x', ''), false);
  assert.equal(isSamePage('', ''), false);
  assert.equal(isSamePage(undefined, 'https://a.test/x'), false);
});

// Only the tab that started draw mode, from its top frame, may answer.
test('acceptDrawnSender takes the draw tab top frame only', () => {
  assert.equal(acceptDrawnSender(7, { tab: { id: 7 }, frameId: 0 }), true);
  assert.equal(acceptDrawnSender(7, { tab: { id: 8 }, frameId: 0 }), false);
  assert.equal(acceptDrawnSender(7, { tab: { id: 7 }, frameId: 3 }), false);
  assert.equal(acceptDrawnSender(null, { tab: { id: 7 }, frameId: 0 }), false);
  assert.equal(acceptDrawnSender(7, { frameId: 0 }), false);
  assert.equal(acceptDrawnSender(7, null), false);
});
