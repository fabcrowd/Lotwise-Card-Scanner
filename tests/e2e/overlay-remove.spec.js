/**
 * The X on a card: removes it from the scan and the lot total. Loads dist/extension-wasm, opens the popup the way the
 * real one opens (its own window), draws boxes over two cards of a lot photo (the same fixture as draw-box.spec.js),
 * then removes a card from the page overlay's X and from the list's X, and checks the scanner follows.
 *
 * The fixture is built from catalog art (data/card-catalog/images, local only); the test skips without it.
 * Models must be in the profile: set DRAW_BOX_PROFILE to a Chrome profile that already holds them.
 * Screenshots go to .tmp/overlay-remove/ and are meant to be opened and checked by eye.
 *
 * Run: npx playwright test overlay-remove --project=extension
 */

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT_PATH = path.join(ROOT, 'dist/extension-wasm');
const CATALOG = path.join(ROOT, 'data/card-catalog/images');
const OUT = path.join(ROOT, '.tmp/overlay-remove');
const PROFILE = process.env.DRAW_BOX_PROFILE || '';
const HTTP_PORT = 8463;

const NATURAL = { w: 2200, h: 1280 };
const SHOWN = { x: 20, y: 20, w: 1100, h: 640 };
const CARD_NATURAL = { w: 460, h: 642 };
const CARD_SLOTS = [{ x: 140, y: 300 }, { x: 800, y: 300 }, { x: 1460, y: 300 }];
const cardRect = (i) => ({
  x1: SHOWN.x + CARD_SLOTS[i].x / 2, y1: SHOWN.y + CARD_SLOTS[i].y / 2,
  x2: SHOWN.x + (CARD_SLOTS[i].x + CARD_NATURAL.w) / 2, y2: SHOWN.y + (CARD_SLOTS[i].y + CARD_NATURAL.h) / 2,
});

async function makeLotPhoto() {
  const files = fs.readdirSync(CATALOG).filter((f) => /\.(webp|png|jpe?g)$/i.test(f)).sort();
  const picks = [files[1000], files[1001], files[1002]];
  if (picks.some((f) => !f)) return null;
  const layers = [];
  for (const [i, file] of picks.entries()) {
    const card = await sharp(path.join(CATALOG, file)).resize(CARD_NATURAL.w, CARD_NATURAL.h, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
    layers.push({ input: card, left: CARD_SLOTS[i].x, top: CARD_SLOTS[i].y });
  }
  return sharp({ create: { width: NATURAL.w, height: NATURAL.h, channels: 3, background: { r: 92, g: 98, b: 88 } } })
    .composite(layers).jpeg({ quality: 90 }).toBuffer();
}

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pokemon card lot photo</title></head>
<body style="margin:0;background:#fff"><img id="lot" alt="Pokemon cards lot" src="/lot.jpg" style="position:absolute;left:${SHOWN.x}px;top:${SHOWN.y}px;width:${SHOWN.w}px;height:${SHOWN.h}px"></body></html>`;

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

test.describe('Remove a card with the X', () => {
  let context;
  let worker;
  let popup;
  let page;
  let skip = '';
  let server;
  const url = `http://127.0.0.1:${HTTP_PORT}/lot`;

  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (!fs.existsSync(CATALOG)) { skip = 'data/card-catalog/images is missing, so the lot photo cannot be built'; return; }
    const photo = await makeLotPhoto();
    if (!photo) { skip = 'the catalog has too few images'; return; }
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/lot.jpg')) { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': photo.length }); res.end(photo); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
    });
    await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
    const args = [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-sandbox'];
    context = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1200, height: 900 }, args });
    // The last overlay the popup pushed, and every message the page sends, so the test can see both sides.
    await context.addInitScript(() => {
      if (!location.href.startsWith('chrome-extension://')) return;
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__overlay = [];
      chrome.runtime.sendMessage = (...a) => {
        if (a[0]?.action === 'overlayWithGrid') window.__overlay = JSON.parse(JSON.stringify(a[0].cards || []));
        return orig(...a);
      };
    });
    const isExt = (w) => w.url().startsWith('chrome-extension://');
    worker = context.serviceWorkers().find(isExt) || await context.waitForEvent('serviceworker', { predicate: isExt, timeout: 30_000 });
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  });

  async function openPopup() {
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/popup.html'), timeout: 15_000 });
    await worker.evaluate(async () => { await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 500, height: 720, focused: false }); });
    popup = await opened;
    await popup.waitForFunction(() => {
      const o = document.getElementById('setup-overlay');
      return !document.getElementById('btn-scan')?.disabled || (o && o.style.display === 'flex');
    });
    if (await popup.locator('#setup-overlay').isVisible() && await popup.locator('#btn-setup').isVisible()) {
      await popup.locator('#btn-setup').click();
      await popup.waitForFunction(() => !document.getElementById('btn-scan')?.disabled, null, { timeout: 15 * 60_000 });
    }
    for (const id of ['#btn-wiz-skip', '#btn-wiz-access-skip']) if (await popup.locator(id).isVisible()) await popup.locator(id).click();
  }

  async function drawOver(i, rows) {
    const r = cardRect(i);
    await popup.locator('#btn-draw').click();
    await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => d.textContent === 'Drag a box around the card. Esc to cancel.'), null, { timeout: 10_000 });
    await page.mouse.move(r.x1 + 3, r.y1 + 3);
    await page.mouse.down();
    await page.mouse.move((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, { steps: 5 });
    await page.mouse.move(r.x2 - 3, r.y2 - 3, { steps: 5 });
    await page.mouse.up();
    await popup.waitForFunction((n) => document.querySelectorAll('#results .card-row').length >= n, rows, { timeout: 90_000 });
  }

  // A page with two cards found and the scanner window open beside it.
  // Each test uses its own address: a lot is saved per page and would otherwise come back into the next test.
  async function twoCards(query) {
    page = await context.newPage();
    await page.goto(`${url}?${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('lot')?.complete && document.getElementById('lot').naturalWidth > 0);
    await openPopup();
    await page.bringToFront();
    await drawOver(0, 1);
    await drawOver(2, 2);
    await page.waitForTimeout(800);
  }

  const totals = () => popup.locator('#lot-totals').innerText();
  const overlayBox = (i) => popup.evaluate((n) => window.__overlay[n]?.box ?? null, i);

  test('the X on a hovered page card removes it, and Put back restores it', async () => {
    test.skip(Boolean(skip), skip);
    await twoCards('page-x');
    const before = await totals();
    const box = await overlayBox(0);
    expect(box).toBeTruthy();
    const [x1, y1, x2, y2] = box;
    // The X shows only while the card is hovered: move onto the card, then to its top-right corner.
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2);
    await page.waitForTimeout(400);
    await page.mouse.move(x2 - 2, y1 + 6, { steps: 4 });
    await page.mouse.move(x2, y1, { steps: 3 });
    await page.waitForTimeout(400);
    await shot(page, 'x-hover.png');

    await page.mouse.click(x2, y1);
    await expect(popup.locator('#skipped-heading')).toHaveText('Removed (1)');
    await expect(popup.locator('#lot-totals .lt-skipped')).toContainText('Removed');
    await expect(popup.locator('#lot-totals .lt-skipped b')).toHaveText('1');
    expect(await totals()).not.toBe(before);
    expect(await overlayBox(0)).toBeNull();
    expect(await overlayBox(1)).toBeTruthy();
    await shot(popup, 'popup-removed.png');

    await popup.locator('#skipped-heading').click();
    await expect(popup.locator('.skipped-row .unrec-name')).toHaveText('Card 1: removed');
    await popup.locator('.skipped-row [data-put-back]').click();
    await expect(popup.locator('#skipped-heading')).toHaveCount(0);
    await expect(popup.locator('#lot-totals .lt-skipped')).toHaveCount(0);
    expect(await totals()).toBe(before);
    expect(await overlayBox(0)).toBeTruthy();
    await popup.close();
    await page.close();
  });

  test('the X on a list row removes the card, moves focus on, and the page stops drawing its box', async () => {
    test.skip(Boolean(skip), skip);
    await twoCards('row-x');
    const before = await totals();
    const buttons = popup.locator('#results button[data-remove-card]');
    await expect(buttons).toHaveCount(2);
    await shot(popup, 'popup-x.png');
    const idx = Number(await buttons.first().getAttribute('data-idx'));
    await buttons.first().click();
    await expect(popup.locator('#skipped-heading')).toHaveText('Removed (1)');
    expect(await totals()).not.toBe(before);
    expect(await overlayBox(idx)).toBeNull();
    // Focus lands on the other row's X, never on the page body.
    const focused = await popup.evaluate(() => ({ remove: document.activeElement?.matches('#results button[data-remove-card]'), idx: document.activeElement?.dataset?.idx }));
    expect(focused.remove).toBe(true);
    expect(Number(focused.idx)).not.toBe(idx);
    // The removed row has no X of its own: Put back is its action.
    await popup.locator('#skipped-heading').click();
    await expect(popup.locator('.skipped-row [data-remove-card]')).toHaveCount(0);
    await popup.close();
    await page.close();
  });

  test('while a scan is running nothing can store the removal, so the page keeps the box', async () => {
    test.skip(Boolean(skip), skip);
    await twoCards('scanning-x');
    const box = await overlayBox(0);
    expect(box).toBeTruthy();
    const [x1, y1, x2, y2] = box;
    await popup.locator('#btn-scan').click();
    await expect(popup.locator('#btn-scan')).toBeDisabled();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2);
    await page.waitForTimeout(300);
    await page.mouse.move(x2, y1, { steps: 3 });
    await page.waitForTimeout(300);
    await page.mouse.click(x2, y1);
    // The scan is still running: the click was refused, and no card is marked removed.
    const stillScanning = await popup.locator('#btn-scan').isDisabled();
    await shot(page, 'x-refused-while-scanning.png');
    expect(stillScanning, 'the scan finished before the click: not a valid run').toBe(true);
    await expect(popup.locator('#skipped-heading')).toHaveCount(0);
    await popup.waitForFunction(() => !document.getElementById('btn-scan')?.disabled, null, { timeout: 120_000 });
    await expect(popup.locator('#lot-totals .lt-skipped')).toHaveCount(0);
    await popup.close();
    await page.close();
  });
});
