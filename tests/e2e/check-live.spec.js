/**
 * The packaged "is this a card" check is live and hides a non-card box.
 *
 * Loads the built extension (dist/extension-wasm, or CHECK_LIVE_EXT), scans a lot photo composed from catalog art
 * (data/card-catalog/images, local only) plus one synthetic non-card object, and checks:
 *   1. the service worker says the packaged check is live ("card check: packaged"), never "card check: off";
 *   2. the non-card is hidden (popup group "Hidden: not a card", worker log "box dropped by the card check")
 *      while the real cards stay in the visible list.
 *
 * Skips without the catalog images or without CHECK_LIVE_PROFILE (a Chrome profile that already holds the models).
 * CHECK_LIVE_EXT points at another extension folder, e.g. a deliberately broken copy, to show the test failing.
 * Screenshots go to .tmp/check-live/.
 *
 * Run: npx playwright test check-live --project=extension
 */

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT_PATH = process.env.CHECK_LIVE_EXT ? path.resolve(process.env.CHECK_LIVE_EXT) : path.join(ROOT, 'dist/extension-wasm');
const CATALOG = path.join(ROOT, 'data/card-catalog/images');
const OUT = path.join(ROOT, '.tmp/check-live');
const PROFILE = process.env.CHECK_LIVE_PROFILE || '';
const HTTP_PORT = 8463;

// The lot photo: 2200x1280 natural, shown at 1100x640 at (20, 20) of the page. Two real cards and one non-card.
const NATURAL = { w: 2200, h: 1280 };
const SHOWN = { x: 20, y: 20, w: 1100, h: 640 };
const CARD_NATURAL = { w: 460, h: 642 };
const SLOTS = [{ x: 140, y: 300 }, { x: 800, y: 300 }, { x: 1460, y: 300 }];
const REAL_CARDS = 2;
const REAL_SLOT_IDX = [0, 1];
const NON_CARD_SLOT_IDX = 2;

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_NATURAL.w}" height="${CARD_NATURAL.h}" viewBox="0 0 ${CARD_NATURAL.w} ${CARD_NATURAL.h}">${body}</svg>`);

// The non-card: a playing card (white rounded rectangle, spades and "A" in the corners). The detector boxes it and the
// check drops it at p=0.00 in two consecutive runs (threshold about 0.084). A round gold coin was boxed but kept, so it is not used.
const nonCard = () => svg(`<rect x="10" y="10" width="440" height="622" rx="30" fill="#fff" stroke="#bbb" stroke-width="4"/>
    <text x="40" y="90" font-size="80" font-family="Arial" font-weight="bold" fill="#111">A</text><text x="40" y="150" font-size="60" fill="#111">&#9824;</text>
    <text x="230" y="420" font-size="300" text-anchor="middle" fill="#111">&#9824;</text>
    <g transform="rotate(180 230 321)"><text x="40" y="90" font-size="80" font-family="Arial" font-weight="bold" fill="#111">A</text><text x="40" y="150" font-size="60" fill="#111">&#9824;</text></g>`);

async function makeLotPhoto() {
  const files = fs.readdirSync(CATALOG).filter((f) => /\.(webp|png|jpe?g)$/i.test(f)).sort();
  const picks = [files[1000], files[1001]];
  if (picks.some((f) => !f)) return null;
  const layers = [];
  for (const [i, file] of picks.entries()) {
    const card = await sharp(path.join(CATALOG, file)).resize(CARD_NATURAL.w, CARD_NATURAL.h, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
    layers.push({ input: card, left: SLOTS[i].x, top: SLOTS[i].y });
  }
  layers.push({ input: await sharp(nonCard()).png().toBuffer(), left: SLOTS[2].x, top: SLOTS[2].y });
  return sharp({ create: { width: NATURAL.w, height: NATURAL.h, channels: 3, background: { r: 92, g: 98, b: 88 } } })
    .composite(layers).jpeg({ quality: 90 }).toBuffer();
}

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pokemon card lot photo</title></head>
<body style="margin:0;background:#fff"><img id="lot" alt="Pokemon cards lot" src="/lot.jpg" style="position:absolute;left:${SHOWN.x}px;top:${SHOWN.y}px;width:${SHOWN.w}px;height:${SHOWN.h}px"></body></html>`;

const listen = (server, port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

test.describe('Packaged card check', () => {
  let context;
  let worker;
  let server;
  let skip = '';
  const logs = [];

  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (!PROFILE) { skip = 'CHECK_LIVE_PROFILE is not set (a Chrome profile that already holds the models)'; return; }
    if (!fs.existsSync(CATALOG)) { skip = 'data/card-catalog/images is missing, so the lot photo cannot be built'; return; }
    const photo = await makeLotPhoto();
    if (!photo) { skip = 'the catalog has too few images'; return; }
    fs.writeFileSync(path.join(OUT, 'lot-fixture.jpg'), photo);
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/lot.jpg')) { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': photo.length }); res.end(photo); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
    });
    await listen(server, HTTP_PORT);
    const args = [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-sandbox'];
    context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1200, height: 900 }, args });
    // The "card check: packaged" line is logged once at worker start, so listen as early as Playwright allows:
    // on every worker that appears and on any already present. No shipped message reports the check state.
    const isExt = (w) => w.url().startsWith('chrome-extension://');
    const seen = new Set();
    const watch = (w) => { if (!isExt(w) || seen.has(w)) return; seen.add(w); worker = w; w.on('console', (m) => logs.push(m.text())); };
    context.on('serviceworker', watch);
    context.serviceWorkers().forEach(watch);
    if (!worker) await context.waitForEvent('serviceworker', { predicate: isExt, timeout: 30_000 });
    // The popup's last overlay payload (boxes in page coordinates; a hidden entry has a null box), as draw-box.spec.js reads it.
    await context.addInitScript(() => {
      if (!location.href.startsWith('chrome-extension://')) return;
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__overlay = [];
      chrome.runtime.sendMessage = (...a) => {
        if (a[0]?.action === 'overlayWithGrid') window.__overlay = JSON.parse(JSON.stringify(a[0].cards || []));
        return orig(...a);
      };
    });
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  });

  test('the packaged card check is live and hides a non-card box', async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/lot`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('lot')?.complete && document.getElementById('lot').naturalWidth > 0);

    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/popup.html'), timeout: 15_000 });
    await worker.evaluate(async () => { await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 500, height: 720, focused: false }); });
    const popup = await opened;
    await popup.waitForFunction(() => {
      const o = document.getElementById('setup-overlay');
      return !document.getElementById('btn-scan')?.disabled || (o && o.style.display === 'flex');
    });
    if (await popup.locator('#setup-overlay').isVisible() && await popup.locator('#btn-setup').isVisible()) {
      await popup.locator('#btn-setup').click();
      await popup.waitForFunction(() => !document.getElementById('btn-scan')?.disabled, null, { timeout: 15 * 60_000 });
    }
    for (const id of ['#btn-wiz-skip', '#btn-wiz-access-skip']) if (await popup.locator(id).isVisible()) await popup.locator(id).click();
    await page.bringToFront();

    await popup.locator('#btn-scan').click();
    await popup.waitForFunction(() => !document.getElementById('btn-scan')?.disabled && document.querySelectorAll('#results .card-row').length > 0, null, { timeout: 120_000 });
    await page.waitForTimeout(800);
    await popup.locator('#notcard-heading').click({ timeout: 5_000 }).catch(() => {});
    // Screenshots are for checking by eye only; an unfocused popup window can refuse to paint, so they never fail the test.
    await popup.screenshot({ path: path.join(OUT, 'popup.png'), timeout: 10_000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, 'page.png'), timeout: 10_000 }).catch(() => {});

    const dropped = logs.filter((l) => l.includes('box dropped by the card check'));

    // 1. The packaged check loaded (a rejected file leaves it silently "off").
    expect(logs.filter((l) => l.includes('card check: off')), 'the service worker reports the card check off').toEqual([]);
    expect(logs.some((l) => /card check: packaged/.test(l)), 'a "card check: packaged" line in the service worker log').toBe(true);

    // 2. The non-card is hidden and the real cards are not.
    const heading = (await popup.locator('#notcard-heading').innerText({ timeout: 3_000 }).catch(() => '')).trim();
    const hidden = Number(/\((\d+)\)/.exec(heading)?.[1] ?? 0);
    expect(heading, 'the "Hidden: not a card" group is in the popup').toMatch(/^Hidden: not a card/);
    expect(hidden, 'exactly one box is hidden').toBe(1);
    expect(dropped.length, 'one "box dropped by the card check" line in the service worker log').toBe(1);
    const visibleRows = await popup.evaluate(() => [...document.querySelectorAll('#results .card-row')].filter((r) => !r.closest('#notcard-list')).length);
    expect(visibleRows, 'the visible list holds exactly the real cards').toBe(REAL_CARDS);

    // 3. By position: each real card's slot has an overlay box over it, and none of the overlay boxes is on the non-card.
    const overlay = await popup.evaluate(() => window.__overlay);
    const boxes = overlay.map((c) => c.box).filter(Boolean);
    expect(overlay.filter((c) => c.box == null).length, 'one overlay entry has no box (the hidden one)').toBe(1);
    expect(boxes.length, 'one overlay box per real card').toBe(REAL_CARDS);
    const scale = SHOWN.w / NATURAL.w;
    const slotRect = (i) => ({ x1: SHOWN.x + SLOTS[i].x * scale, y1: SHOWN.y + SLOTS[i].y * scale, x2: SHOWN.x + (SLOTS[i].x + CARD_NATURAL.w) * scale, y2: SHOWN.y + (SLOTS[i].y + CARD_NATURAL.h) * scale });
    const centreIn = (b, r) => { const cx = (b[0] + b[2]) / 2; const cy = (b[1] + b[3]) / 2; return cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2; };
    for (const i of REAL_SLOT_IDX) expect(boxes.some((b) => centreIn(b, slotRect(i))), `an overlay box sits over real card slot ${i}`).toBe(true);
    expect(boxes.filter((b) => centreIn(b, slotRect(NON_CARD_SLOT_IDX))), 'no overlay box on the non-card slot').toEqual([]);

    await popup.close();
    await page.close();
  });
});
