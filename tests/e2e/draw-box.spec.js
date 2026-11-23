/**
 * "Draw a box": the user marks a card the scan missed. Loads dist/extension-wasm, opens the popup the way the real one
 * opens (its own window), enters draw mode from the popup button, drags over a card in a lot photo and checks that a row
 * appears and the page overlay draws its box where the box was drawn.
 *
 * The fixture is a lot photo composed from catalog art (data/card-catalog/images, local only); the test skips without it.
 * Models must be in the profile: set DRAW_BOX_PROFILE to a Chrome profile that already holds them (a fresh one downloads them).
 * Screenshots go to .tmp/draw-box/ and are meant to be opened and checked by eye.
 *
 * Run: npx playwright test draw-box --project=extension
 */

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT_PATH = path.join(ROOT, 'dist/extension-wasm');
const CATALOG = path.join(ROOT, 'data/card-catalog/images');
const OUT = path.join(ROOT, '.tmp/draw-box');
const CERT_DIR = path.join(ROOT, '.tmp/g2');
const PROFILE = process.env.DRAW_BOX_PROFILE || '';

// The lot photo: 2200x1280 natural, shown at 1100x640 (scale 0.5) at (20, 20) of the page. Three cards in a row.
const NATURAL = { w: 2200, h: 1280 };
const SHOWN = { x: 20, y: 20, w: 1100, h: 640 };
const CARD_NATURAL = { w: 460, h: 642 };
const CARD_SLOTS = [{ x: 140, y: 300 }, { x: 800, y: 300 }, { x: 1460, y: 300 }];
// A card's rectangle in the viewport (CSS px) as the page shows it.
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

function handler(photo) {
  return (req, res) => {
    if (req.url.startsWith('/lot.jpg')) { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': photo.length }); res.end(photo); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  };
}

const listen = (server, port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

test.describe('Draw a box', () => {
  let context;
  let worker;
  let popup;
  let skip = '';
  const servers = [];
  let photo = null;
  const secure = fs.existsSync(path.join(CERT_DIR, 'key.pem'));
  const HOST = 'lots.example.com';
  const HTTPS_PORT = 8461;
  const HTTP_PORT = 8462;

  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (!fs.existsSync(CATALOG)) { skip = 'data/card-catalog/images is missing, so the lot photo cannot be built'; return; }
    photo = await makeLotPhoto();
    if (!photo) { skip = 'the catalog has too few images'; return; }
    fs.writeFileSync(path.join(OUT, 'lot-fixture.jpg'), photo);
    const plain = http.createServer(handler(photo));
    await listen(plain, HTTP_PORT);
    servers.push(plain);
    const args = [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-sandbox'];
    if (secure) {
      const tls = https.createServer({ key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')), cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')) }, handler(photo));
      await listen(tls, HTTPS_PORT);
      servers.push(tls);
      args.push('--ignore-certificate-errors', `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${HTTPS_PORT}`);
    }
    context = await chromium.launchPersistentContext(PROFILE, { headless: false, ignoreHTTPSErrors: true, viewport: { width: 1200, height: 900 }, args });
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
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
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

  // Draws over card `i` (inset a few px so the drag starts on the photo), then waits for the popup to list `rows` rows.
  async function drawOver(page, i, rows) {
    const r = cardRect(i);
    const drawn = { x1: r.x1 + 3, y1: r.y1 + 3, x2: r.x2 - 3, y2: r.y2 - 3 };
    await popup.locator('#btn-draw').click();
    await page.waitForFunction(() => [...document.querySelectorAll('span')].some((d) => d.textContent === 'Drag a box around the card. Esc to cancel.'), null, { timeout: 10_000 });
    if (i === 0) await shot(page, 'during-draw.png');
    await page.mouse.move(drawn.x1, drawn.y1);
    await page.mouse.down();
    await page.mouse.move((drawn.x1 + drawn.x2) / 2, (drawn.y1 + drawn.y2) / 2, { steps: 5 });
    await page.mouse.move(drawn.x2, drawn.y2, { steps: 5 });
    await page.mouse.up();
    await popup.waitForFunction((n) => document.querySelectorAll('#results .card-row').length >= n, rows, { timeout: 90_000 });
    return drawn;
  }

  const runCase = (title, url) => test(title, async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('lot')?.complete && document.getElementById('lot').naturalWidth > 0);
    await openPopup();
    await page.bringToFront();
    const tag = url.startsWith('https') ? 'source' : 'screenshot';
    await shot(page, `${tag}-0-before.png`);

    const logs = [];
    worker.on('console', (m) => logs.push(m.text()));

    // The dev build keeps each drawn box as a local training example (the profile persists, so count from here).
    const logged = () => popup.evaluate(() => chrome.runtime.sendMessage({ action: 'exportDrawnExamples', from: 0 }));
    const loggedBefore = (await logged()).total;

    // First box: no scan yet, so it starts a one-card result.
    const first = await drawOver(page, 0, 1);
    await page.waitForTimeout(800);
    await shot(page, `${tag}-1-after-first.png`);
    expect(await popup.locator('#results .card-row').count()).toBe(1);

    // Second box: appended as row 2.
    const second = await drawOver(page, 2, 2);
    await page.waitForTimeout(800);
    await shot(page, `${tag}-2-after-second.png`);
    await popup.screenshot({ path: path.join(OUT, `${tag}-popup.png`), fullPage: true });
    expect(await popup.locator('#results .card-row').count()).toBe(2);

    // The overlay got both boxes, at the places they were drawn (within a few px of the cropped read).
    const overlay = await popup.evaluate(() => window.__overlay);
    expect(overlay.length).toBe(2);
    for (const [i, want] of [first, second].entries()) {
      const box = overlay[i].box;
      expect(box, `overlay box ${i + 1}`).toBeTruthy();
      expect(Math.abs(box[0] - want.x1)).toBeLessThan(6);
      expect(Math.abs(box[1] - want.y1)).toBeLessThan(6);
      expect(Math.abs(box[2] - want.x2)).toBeLessThan(6);
      expect(Math.abs(box[3] - want.y2)).toBeLessThan(6);
    }
    // Each box made exactly one example, with the kind the popup reported (both started or joined a result with nothing to replace).
    await expect.poll(async () => (await logged()).total, { timeout: 15_000 }).toBe(loggedBefore + 2);
    await expect.poll(async () => (await logged()).examples.slice(-2).map((e) => e.kind), { timeout: 15_000 }).toEqual(['missed', 'missed']);
    const example = (await logged()).examples.at(-1);
    expect(example.source).toBe(secure && tag === 'source' ? 'photo' : 'screenshot');
    expect(example.photo.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(Math.max(example.photoWidth, example.photoHeight)).toBeLessThanOrEqual(1600);
    expect(example.box.length).toBe(4);
    expect(logs.some((l) => l.includes('[BG] drawn box') && l.includes(secure && tag === 'source' ? '(source image' : '(viewport crop)'))).toBe(true);
    await popup.close();
    await page.close();
  });

  if (secure) runCase('over https the source image is read and the box maps back through its placement', `https://${HOST}/lot`);
  runCase('over http the screenshot is cropped where the box was drawn', `http://127.0.0.1:${HTTP_PORT}/lot`);

  test('Esc leaves draw mode and the page keeps working', async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/lot`, { waitUntil: 'load' });
    await openPopup();
    await page.bringToFront();
    await popup.locator('#btn-draw').click();
    const hint = () => page.evaluate(() => [...document.querySelectorAll('span')].some((d) => d.textContent === 'Drag a box around the card. Esc to cancel.'));
    await page.waitForFunction(() => [...document.querySelectorAll('span')].some((d) => d.textContent === 'Drag a box around the card. Esc to cancel.'));
    await page.keyboard.press('Escape');
    expect(await hint()).toBe(false);
    await expect(popup.locator('#btn-draw')).toHaveAttribute('aria-pressed', 'false');
    await shot(page, 'esc-after.png');
    await popup.close();
    await page.close();
  });

  // Section 10: a plain click keeps draw mode, the hint bar's Cancel button leaves it, and the header crosshair is a toggle.
  test('10: a click without a drag keeps draw mode; Cancel and the pressed crosshair leave it', async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/lot`, { waitUntil: 'load' });
    await openPopup();
    await page.bringToFront();
    const draw = popup.locator('#btn-draw');
    const hintIs = (text) => page.evaluate((t) => [...document.querySelectorAll('span')].some((s) => s.textContent === t), text);
    const cancelCount = () => page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Cancel').length);
    await expect(draw).toHaveAttribute('aria-pressed', 'false');

    await draw.click();
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => [...document.querySelectorAll('span')].some((s) => s.textContent === 'Drag a box around the card. Esc to cancel.'));
    await page.mouse.click(600, 400); // a click, no drag: draw mode stays, the hint says what to do
    await expect.poll(() => hintIs('Drag a box around the card.')).toBe(true);
    expect(await cancelCount()).toBe(1);
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'click-keeps-draw.png');

    const cancel = page.locator('button', { hasText: 'Cancel' });
    await cancel.click(); // the hint bar's Cancel button
    await expect.poll(cancelCount).toBe(0);
    await expect(draw).toHaveAttribute('aria-pressed', 'false');

    await draw.click();
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => document.querySelectorAll('button').length > 0 && [...document.querySelectorAll('button')].some((b) => b.textContent === 'Cancel'));
    await draw.click(); // pressing the crosshair again cancels
    await expect(draw).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(cancelCount).toBe(0);
    await popup.close();
    await page.close();
  });
});
