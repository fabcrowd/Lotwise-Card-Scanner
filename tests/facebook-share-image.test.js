import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { facebookListingPage, fullSizeCandidates, largerRendition, needsShareImages, shareImagesFromHtml } from '../tools/extension-wasm/lib/full-size.js';
import { loadPage } from './helpers/fake-page.js';

// D9 of the 2026-10-25 QA gate: a logged-in Marketplace item page has no og:image. The same page fetched without
// cookies names the cover photo's upload (`ctp=...&cstp=mx1536x2048`), which full-size.js turns into the 2048 px copy.
// Fixture: .tmp/fb-fullsize/fixture-candidate-marketplace-photo-sizes.json (redacted), see .tmp/fb-fullsize/findings.md.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/facebook-marketplace-photo-sizes.json', import.meta.url), 'utf8'));
const LISTING = 'https://www.facebook.com/marketplace/item/2625050071341628/';
const HOST = 'scontent.fluk1-1.fna.fbcdn.net';
const cover = fixture.liveDom.foregroundImg;
const photo2 = fixture.loggedInInlineRelay.target.listing_photos[1].image;
const ogUrl = fixture.loggedOutHtmlHead.html.match(/og:image" content="([^"]+)"/)[1].replaceAll('&amp;', '&');

test('a Marketplace item URL gives its canonical page; any other URL gives null', () => {
  assert.equal(facebookListingPage(`${LISTING}?ref=search&referral_code=null&tracking=abc`), LISTING);
  assert.equal(facebookListingPage('https://www.facebook.com/marketplace/item/2625050071341628'), LISTING);
  assert.equal(facebookListingPage('https://www.facebook.com/marketplace/item/2625050071341628/photos/?x=1#top'), LISTING);
  assert.equal(facebookListingPage('https://web.facebook.com/marketplace/item/2625050071341628/'), 'https://web.facebook.com/marketplace/item/2625050071341628/');
  for (const url of [
    'https://www.facebook.com/marketplace/',
    'https://www.facebook.com/marketplace/category/pokemon',
    'https://www.facebook.com/marketplace/item/',
    'https://www.facebook.com/marketplace/item/abc/',
    'https://www.facebook.com/groups/123456789/',
    'http://www.facebook.com/marketplace/item/2625050071341628/',
    'https://www.facebook.com.evil.example/marketplace/item/2625050071341628/',
    'https://shop.example/marketplace/item/2625050071341628/',
    'not a url',
    '',
    undefined,
  ]) assert.equal(facebookListingPage(url), null, String(url));
});

test('the share images of the logged-out page head are its og and twitter image URLs, decoded, https only', () => {
  assert.deepEqual(shareImagesFromHtml(fixture.loggedOutHtmlHead.html), [ogUrl]);
  const html = `<head><meta property="og:image:secure_url" content='https://a.example/x.jpg?a=1&amp;b=2'>
    <meta content="https://b.example/y.jpg" name="twitter:image"><meta property="og:image" content="http://c.example/z.jpg">
    <meta property="og:title" content="https://d.example/t.jpg"><meta property="og:image" content="javascript:alert(1)"></head>`;
  assert.deepEqual(shareImagesFromHtml(html), ['https://a.example/x.jpg?a=1&b=2', 'https://b.example/y.jpg']);
  assert.deepEqual(shareImagesFromHtml(''), []);
  assert.deepEqual(shareImagesFromHtml(undefined), []);
  const many = Array.from({ length: 9 }, (_, i) => `<meta property="og:image" content="https://e.example/${i}.jpg">`).join('');
  assert.equal(shareImagesFromHtml(many).length, 4);
});

test('with the share images, the cover photo gets its 2048 px upload; photo 2 still gets no candidate', () => {
  const ogImages = shareImagesFromHtml(fixture.loggedOutHtmlHead.html);
  const want = new URL(ogUrl);
  want.searchParams.delete('ctp');
  assert.deepEqual(fullSizeCandidates({ src: cover.src, naturalWidth: 720, ogImages: [], allowedHosts: [HOST] }), [], 'today');
  assert.deepEqual(fullSizeCandidates({ src: cover.src, naturalWidth: 720, ogImages, allowedHosts: [HOST] }), [want.href]);
  assert.deepEqual({ ...largerRendition({ src: cover.src, naturalWidth: 720, naturalHeight: 960, ogImages }) }, { url: want.href, side: 2048 });
  assert.deepEqual(fullSizeCandidates({ src: photo2.uri, naturalWidth: 960, ogImages, allowedHosts: [HOST] }), []);
  assert.equal(largerRendition({ src: photo2.uri, naturalWidth: 960, naturalHeight: 720, ogImages }), null);
});

test('the share page is wanted only on an item page whose own og:image names no upload', () => {
  assert.equal(needsShareImages(`${LISTING}?ref=search`, []), LISTING);
  assert.equal(needsShareImages(LISTING, undefined), LISTING);
  assert.equal(needsShareImages(LISTING, ['https://static.xx.fbcdn.net/rsrc.php/v3/logo.png']), LISTING);
  assert.equal(needsShareImages(LISTING, [ogUrl]), null, 'the live DOM already has a usable og:image');
  assert.equal(needsShareImages('https://www.facebook.com/marketplace/', []), null);
  assert.equal(needsShareImages('https://www.ebay.com/itm/123456789', []), null);
});

// content.js does the fetch: same origin, no cookies, only when the scan asks.
const encoder = new TextEncoder();
function htmlResponse(chunks, { headers = {}, url = LISTING, ok = true } = {}) {
  const parts = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
  let cancelled = false;
  return {
    ok, status: ok ? 200 : 500, url,
    headers: { get: (name) => ({ 'content-type': 'text/html; charset="utf-8"', ...headers })[name.toLowerCase()] ?? null },
    body: { getReader: () => ({ read: async () => (cancelled || !parts.length ? { done: true } : { done: false, value: parts.shift() }), cancel: async () => { cancelled = true; } }) },
  };
}

function pageWithFetch(fetchImpl, timers = []) {
  const calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); };
  const page = loadPage({
    url: `${LISTING}?ref=search`,
    globals: {
      fetch, AbortController: globalThis.AbortController, TextDecoder,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: () => {},
    },
  });
  return { page, calls, timers };
}

const HEAD = `<html><head>${fixture.loggedOutHtmlHead.html}</head><body>${'x'.repeat(1000)}</body></html>`;

test('the page is never fetched on load or by a plain findCards; the scan asks once, without cookies', async () => {
  const { page, calls } = pageWithFetch(async () => htmlResponse([HEAD]));
  assert.equal(calls.length, 0, 'on page load');
  page.send({ action: 'findCards', thumbs: true });
  assert.equal(calls.length, 0, 'findCards');
  const reply = await page.sendAsync({ action: 'sharePageHead', url: LISTING });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LISTING);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(shareImagesFromHtml(reply.html), [ogUrl]);
  assert.ok(!reply.html.includes('</body>'), 'only the head is passed on');
});

test('another origin is never fetched', async () => {
  const { page, calls } = pageWithFetch(async () => htmlResponse([HEAD]));
  const reply = await page.sendAsync({ action: 'sharePageHead', url: 'https://evil.example/marketplace/item/2625050071341628/' });
  assert.equal(calls.length, 0);
  assert.equal(reply.html, '');
});

test('a timeout, a page over the size cap, an error page or a failed fetch give no share images (today\'s behaviour)', async () => {
  // Timeout: the fetch only settles when aborted; the scan's timer fires.
  const timers = [];
  const hung = pageWithFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), timers);
  const waiting = hung.page.sendAsync({ action: 'sharePageHead', url: LISTING });
  const timer = timers.find((t) => t.ms >= 3000 && t.ms <= 5000);
  assert.ok(timer, `a ~4 s timeout is set (${JSON.stringify(timers.map((t) => t.ms))})`);
  timer.fn();
  assert.equal((await waiting).html, '');

  const MB = 1024 * 1024;
  const big = pageWithFetch(async () => htmlResponse([new Uint8Array(MB), new Uint8Array(MB), HEAD]));
  assert.equal((await big.page.sendAsync({ action: 'sharePageHead', url: LISTING })).html, '', 'over 1.5 MB without a head end');
  const declared = pageWithFetch(async () => htmlResponse([HEAD], { headers: { 'content-length': String(2 * MB) } }));
  assert.equal((await declared.page.sendAsync({ action: 'sharePageHead', url: LISTING })).html, '', 'declared over the cap');
  const failed = pageWithFetch(async () => htmlResponse([HEAD], { ok: false }));
  assert.equal((await failed.page.sendAsync({ action: 'sharePageHead', url: LISTING })).html, '');
  const thrown = pageWithFetch(async () => { throw new Error('network'); });
  assert.equal((await thrown.page.sendAsync({ action: 'sharePageHead', url: LISTING })).html, '');
  const moved = pageWithFetch(async () => htmlResponse([HEAD], { url: 'https://login.example/' }));
  assert.equal((await moved.page.sendAsync({ action: 'sharePageHead', url: LISTING })).html, '', 'redirected to another origin');
  assert.deepEqual(shareImagesFromHtml(''), [], 'and no head means no share images');
});

test('the background asks for the share page once per scan, only when needed, and passes its images to the full-size reads', () => {
  const background = readFileSync(new URL('../tools/extension-wasm/background.js', import.meta.url), 'utf8');
  assert.equal(background.match(/action: "sharePageHead"/g)?.length, 1);
  assert.match(background, /needsShareImages\(targetTab\.url, domResp\?\.page\?\.ogImages\)/);
  assert.match(background, /shareImagesFromHtml\(shared\?\.html\)/);
  assert.match(background, /loadUpgradedSource\(ph, fullSizeOg, targetTab\.url, fetchLimits\)/);
  assert.match(background, /ogImages: fullSizeOg, base: targetTab\.url/);
});
