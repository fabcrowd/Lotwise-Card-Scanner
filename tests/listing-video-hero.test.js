import assert from 'node:assert/strict';
import test from 'node:test';
import { choosePageFocus } from '../tools/extension-wasm/lib/page-focus.js';
import { loadPage, makeNode, rectOf } from './helpers/fake-page.js';

// D8 (QA gate 2026-10-25, F1 "single Charizard"): the listing's hero is a <video>, so no listing photo is found, and the
// "Today's picks" tiles below it (other people's listings) were scanned as the listing: 129 cards, $800-$4,981 on a
// $100 card. Rects are the measured ones from .tmp/smoke/2026-10-25-gate1/F1-single-charizard/geometry-at-scan.raw.txt.

const PAGE_URL = 'https://www.facebook.com/marketplace/item/2233602540730806/';
const TILES = [
  { rect: [775.5, 893, 251.59, 251.59], id: '1097879883068188', alt: 'Pokemon Lot Liquidation - Open to offers' },
  { rect: [1037.09, 893, 251.61, 251.61], id: '1451175999893107', alt: 'Garage Sale TODAY SATURDAY October 24!!!' },
  { rect: [1560.3, 893, 251.61, 251.61], id: '1794693061582864', alt: 'WOTC Sealed Fossil Theme Deck Display Box' },
  { rect: [1037.09, 1233.59, 251.61, 251.61], id: '1008194008844635', alt: 'Vintage Cards for sale' },
  { rect: [1560.3, 1233.59, 251.61, 251.61], id: '2367727877296468', alt: 'Green Bay Packers Autographed Football' },
];

function f1Page() {
  const page = loadPage({ url: PAGE_URL });
  // The hero: a <video> (not an <img>) in the 844x768 slot, over a blurred x11 copy of its poster that never loaded.
  const slot = makeNode('DIV', page.body, { overflowX: 'hidden', overflowY: 'hidden' }, rectOf(774.5, 76, 844, 768));
  const backdrop = makeNode('DIV', slot, { filter: 'blur(2px)', transform: 'matrix(11, 0, 0, 11, 0, 0)' }, rectOf(732.34, 37.61, 928.3, 844.77));
  page.addImg(backdrop, rectOf(732.34, 37.61, 928.3, 844.77), { src: 'https://video.fluk1-1.fna.fbcdn.net/o1/v/t2/f2/m366/AQM6S_poster.jpg', natural: [0, 0] });
  const grid = makeNode('DIV', page.body, {}, rectOf(775.5, 893, 1036.4, 600));
  for (const t of TILES) {
    const link = makeNode('A', grid, {}, rectOf(...t.rect));
    link.attrs.href = `https://www.facebook.com/marketplace/item/${t.id}/?ref=browse_tab&referral_code=marketplace_top_picks`;
    link.href = link.attrs.href;
    page.addImg(link, rectOf(...t.rect), { src: `https://scontent.fluk1-1.fna.fbcdn.net/v/t39.84726-6/${t.id}_n.jpg?stp=c0.43.261.261a_dst-jpg_p261x260_tt6`, natural: [261, 261], alt: t.alt });
  }
  return page;
}

test('D8: a listing led by a video never scans the "Today\'s picks" tiles of other listings', () => {
  const page = f1Page();
  const resp = page.send({ action: 'findCards', thumbs: true });
  assert.ok(resp.photos.length >= 3, 'the tiles are on screen as photo candidates');
  const focus = choosePageFocus({
    viewport: { w: resp.viewportWidth, h: resp.viewportHeight },
    photos: resp.photos,
    cards: resp.cards,
    ogImages: resp.page.ogImages,
    headings: resp.page.headings,
    pageUrl: PAGE_URL,
    pageLinks: resp.page.imageLinks,
  });
  assert.equal(focus.kind, 'listing', 'a listing page: no whole-page scroll, no viewport-wide detector pass');
  // Lengths, not deepEqual: arrays filtered from the vm page's arrays belong to that realm.
  assert.equal(focus.photos.length, 0, 'no tile is a scan photo');
  assert.equal(focus.cards.length, 0, 'no tile is a scan card');
  assert.equal((focus.fallback || []).length, 0, 'no tile is a fallback gallery photo');
});

test('D8: the page reports the links its pictures point to, so tiles off screen count too', () => {
  const page = f1Page();
  const resp = page.send({ action: 'findCards' });
  assert.ok(Array.isArray(resp.page.imageLinks));
  assert.ok(resp.page.imageLinks.includes(`https://www.facebook.com/marketplace/item/${TILES[0].id}/?ref=browse_tab&referral_code=marketplace_top_picks`));
  const tile = resp.photos.find((p) => p.src.includes(TILES[1].id));
  assert.match(tile.ctx.link, /marketplace\/item\/1451175999893107/);
});
