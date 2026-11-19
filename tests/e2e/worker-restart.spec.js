/**
 * The service worker is stopped by Chrome when idle; what background.js keeps in memory is gone when it wakes. Draw mode
 * and the scan result the worker holds are kept in chrome.storage.session (lib/worker-state.js) and read back at start.
 * This spec stops the REAL worker through the DevTools protocol (ServiceWorker.stopWorker) and checks both survive.
 *
 * The fixture is the lot photo of draw-box.spec.js, composed from catalog art (data/card-catalog/images, local only); the
 * test skips without it. Models must be available to the profile (a fresh one downloads them, as in draw-box.spec.js).
 *
 * Run: npx playwright test worker-restart --project=extension
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
const PROFILE = process.env.WORKER_RESTART_PROFILE || '';
const HTTP_PORT = 8472;

// The lot photo: 2200x1280 natural, shown at 1100x640 at (20, 20) of the page. Three cards in a row.
const NATURAL = { w: 2200, h: 1280 };
const SHOWN = { x: 20, y: 20, w: 1100, h: 640 };
const CARD_NATURAL = { w: 460, h: 642 };
const CARD_SLOTS = [{ x: 140, y: 300 }, { x: 800, y: 300 }, { x: 1460, y: 300 }];
const cardRect = (i) => ({
  x1: SHOWN.x + CARD_SLOTS[i].x / 2, y1: SHOWN.y + CARD_SLOTS[i].y / 2,
  x2: SHOWN.x + (CARD_SLOTS[i].x + CARD_NATURAL.w) / 2, y2: SHOWN.y + (CARD_SLOTS[i].y + CARD_NATURAL.h) / 2,
});
const DRAW_HINT = 'Drag a box around the card. Esc to cancel.';

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

const isExt = (w) => w.url().startsWith('chrome-extension://');
const send = (page, message) => page.evaluate((m) => chrome.runtime.sendMessage(m), message);

test.describe('Service worker restart', () => {
  let context;
  let worker;
  let popup;
  let skip = '';
  let server;
  let extId = '';

  test.beforeAll(async () => {
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
    worker = context.serviceWorkers().find(isExt) || await context.waitForEvent('serviceworker', { predicate: isExt, timeout: 30_000 });
    extId = new URL(worker.url()).host;
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  });

  async function openPopup() {
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/popup.html'), timeout: 15_000 });
    const opener = await context.newPage();
    await opener.goto(`chrome-extension://${extId}/options.html`);
    await opener.evaluate(async () => { await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 500, height: 720, focused: false }); });
    popup = await opened;
    await opener.close();
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

  // Stops the extension's real service worker (ServiceWorker.stopWorker over the DevTools protocol). The protocol's own
  // status log is the proof: it shows the worker go "stopping", "stopped", and later "starting" and "running" again once
  // a message wakes it. (Playwright does not track a stopped extension worker: its worker object stays listed and goes
  // stale, so nothing here evaluates in it.) `restarted()` waits for the new run and returns the statuses seen since.
  async function stopWorker() {
    const cdp = await context.newCDPSession(context.pages().find((p) => !p.url().startsWith('chrome-extension://')) || popup);
    const log = [];
    let versionId = null;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const v of versions.filter((x) => x.scriptURL.startsWith(`chrome-extension://${extId}/`))) { versionId = v.versionId; log.push(v.runningStatus); }
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => log.at(-1)).toBe('running');
    await cdp.send('ServiceWorker.stopWorker', { versionId });
    await expect.poll(() => log.at(-1), { message: 'the worker stopped' }).toBe('stopped');
    const stoppedAt = log.length - 1;
    return {
      async restarted() {
        await expect.poll(() => log.slice(stoppedAt + 1).includes('starting'), { timeout: 60_000, message: 'a new worker started' }).toBe(true);
        await expect.poll(() => log.at(-1), { timeout: 60_000 }).toBe('running');
        const statuses = log.slice(stoppedAt - 1);
        await cdp.send('ServiceWorker.disable').catch(() => {});
        await cdp.detach().catch(() => {});
        return { statuses };
      },
    };
  }

  // Case a, and case c for the drawn box: after the stop, the first thing the worker is asked is the drawn box from the page,
  // one of the messages delayed until the restore is done.
  test('draw mode that was on before the worker stopped still accepts the drawn box, and it becomes a card row', async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/lot`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('lot')?.complete && document.getElementById('lot').naturalWidth > 0);
    await openPopup();
    await page.bringToFront();
    await popup.locator('#btn-draw').click();
    await page.waitForFunction((hint) => [...document.querySelectorAll('span')].some((d) => d.textContent === hint), DRAW_HINT, { timeout: 10_000 });

    const stopped = await stopWorker();

    const r = cardRect(0);
    const drawn = { x1: r.x1 + 3, y1: r.y1 + 3, x2: r.x2 - 3, y2: r.y2 - 3 };
    await page.mouse.move(drawn.x1, drawn.y1);
    await page.mouse.down();
    await page.mouse.move((drawn.x1 + drawn.x2) / 2, (drawn.y1 + drawn.y2) / 2, { steps: 5 });
    await page.mouse.move(drawn.x2, drawn.y2, { steps: 5 });
    await page.mouse.up();
    const restart = await stopped.restarted();
    expect(restart.statuses).toEqual(expect.arrayContaining(['stopped', 'starting', 'running']));
    await popup.waitForFunction(() => document.querySelectorAll('#results .card-row').length >= 1, null, { timeout: 90_000 });
    expect(await popup.locator('#results .card-row').count()).toBe(1);
    await popup.close();
    await page.close();
  });

  // Case b, and case c for scanState and awaitScan: nothing else is open, so the first messages the new worker gets are these.
  test('a finished scan the worker holds comes back after the worker stopped, without the card pictures', async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/lot`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('lot')?.complete && document.getElementById('lot').naturalWidth > 0);
    await openPopup();
    await page.bringToFront();
    await popup.locator('#btn-scan').click();
    await expect.poll(async () => (await send(popup, { action: 'scanState' })).finishedAt, { timeout: 120_000 }).not.toBeNull();
    const stateBefore = await send(popup, { action: 'scanState' });
    const heldBefore = await send(popup, { action: 'awaitScan' });
    expect(heldBefore.data, 'the worker holds a result').toBeTruthy();
    await popup.close();

    const stopped = await stopWorker();

    // An extension page of its own, in a window of its own, so nothing else talks to the worker first.
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${extId}/options.html`);
    const stateAfter = await send(probe, { action: 'scanState' });
    const restart = await stopped.restarted();
    expect(restart.statuses).toEqual(expect.arrayContaining(['stopped', 'starting', 'running']));
    expect(stateAfter.finishedAt).toBe(stateBefore.finishedAt);
    expect(stateAfter.heldUrl).toBe(stateBefore.heldUrl);
    expect(stateAfter.heldUrl).toBeTruthy();
    const heldAfter = await send(probe, { action: 'awaitScan' });
    expect(heldAfter.data, 'not an empty state').toBeTruthy();
    expect(heldAfter.data.scanId).toBe(heldBefore.data.scanId);
    expect(heldAfter.data.cards.length).toBe(heldBefore.data.cards.length);
    expect(heldAfter.url).toBe(heldBefore.url);
    expect(heldAfter.finishedAt).toBe(heldBefore.finishedAt);
    expect(heldAfter.data.cards.every((c) => c.crop === null), 'the card pictures are the one thing not kept').toBe(true);
    await probe.close();
    await page.close();
  });
  // A held scan older than 30 minutes is not brought back: session storage outlives the worker, so its rows and prices would look current.
  test('a held scan stored more than 30 minutes ago is not restored, and its record is removed', async () => {
    test.skip(Boolean(skip), skip);
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${extId}/options.html`);
    await probe.evaluate((finishedAt) => chrome.storage.session.set({
      heldScan: { data: { scanId: 'old-scan', cards: [{ identity: { id: 'x-1' }, crop: null }] }, url: 'https://old.example/lot', finishedAt },
    }), Date.now() - 31 * 60_000);
    const stopped = await stopWorker();
    const state = await send(probe, { action: 'scanState' });
    const restart = await stopped.restarted();
    expect(restart.statuses).toEqual(expect.arrayContaining(['stopped', 'starting', 'running']));
    expect(state.finishedAt).toBeNull();
    expect(state.heldUrl).toBeNull();
    expect((await send(probe, { action: 'awaitScan' })).data).toBeNull();
    expect(await probe.evaluate(async () => 'heldScan' in (await chrome.storage.session.get('heldScan')))).toBe(false);
    await probe.close();
  });
});
