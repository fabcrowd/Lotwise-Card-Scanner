/**
 * Japanese cards, end to end: loads dist/extension-wasm, scans a local page with two Japanese catalog pictures and one English
 * card, and checks the Japanese cards come back as questions with Japanese candidates, a pick prices from TCGPlayer's feed,
 * the export says "raw, Japanese, Near Mint", the picker search finds the other card, and the options switch turns it all off.
 *
 * The real catalog-ja.bin.gz (card-scanner-data) is served by intercepting the release URL, so the pinned hash is really checked.
 * The price feed (tcgcsv.com) and the thumbnail host are intercepted too, so nothing here calls a live service.
 * Models must be in the profile: set JAPANESE_PROFILE to a Chrome profile that already holds them, or the test copies
 * .tmp/draw-box/profile (a fresh profile would download ~150 MB). The profile is copied, so the original is never touched.
 *
 * Run: npx playwright test tests/e2e/japanese-cards.spec.js --project=extension
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
const FIX = path.join(ROOT, 'tests/fixtures/japanese');
const REAL_CATALOG = 'C:\\repos\\projects\\card-scanner-data\\data\\ja-catalog\\catalog-ja.bin.gz';
const OUT = path.join(ROOT, '.tmp/japanese-cards');
const SOURCE_PROFILE = process.env.JAPANESE_PROFILE || path.join(ROOT, '.tmp/draw-box/profile');
const PROFILE = path.join(OUT, 'profile');

const CATALOG_URL = 'https://github.com/fabcrowd/pokemon-auto-lister/releases/download/v3.2/catalog-ja.bin.gz';
const SNEASEL = { id: 'jp-569885', file: '569885.jpg', name: 'Hisuian Sneasel', number: '042/067', price: '0.37' };
const SWITCHER = { id: 'jp-569591', file: '569591.jpg', name: 'Cross Switcher', number: '090/100', price: '0.64' };

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pokemon card lot photos</title></head>
<body style="margin:0;background:#fff;padding:20px">
<img alt="Pokemon card 1" src="/sneasel.jpg" height="300" style="margin-right:20px">
<img alt="Pokemon card 2" src="/switcher.jpg" height="300" style="margin-right:20px">
<img alt="Pokemon card 3" src="/english.jpg" height="300">
</body></html>`;

const skipReason = () => {
  if (!fs.existsSync(REAL_CATALOG)) return `the real Japanese catalog is not on disk at ${REAL_CATALOG}`;
  if (!fs.existsSync(SOURCE_PROFILE)) return `no Chrome profile with the models at ${SOURCE_PROFILE} (set JAPANESE_PROFILE)`;
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) return 'dist/extension-wasm is not built';
  return '';
};

test.describe('Japanese cards', () => {
  let context;
  let worker;
  let extensionId;
  let server;
  let baseUrl;
  let thumb;
  let skip = '';
  const requested = [];
  let host;
  const workerLogs = [];

  test.beforeAll(async () => {
    skip = skipReason();
    if (skip) return;
    fs.rmSync(PROFILE, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    fs.cpSync(SOURCE_PROFILE, PROFILE, { recursive: true, filter: (src) => !/Singleton(Lock|Cookie|Socket)$|lockfile$/.test(src) });
    // The copied profile remembers the service worker script of whatever build it was made with; drop that so this build runs.
    // (The models live in Service Worker/CacheStorage, which stays.)
    for (const dir of ['ScriptCache', 'Database']) fs.rmSync(path.join(PROFILE, 'Default', 'Service Worker', dir), { recursive: true, force: true });
    thumb = await sharp({ create: { width: 63, height: 88, channels: 3, background: { r: 120, g: 150, b: 200 } } }).jpeg().toBuffer();
    const files = { '/sneasel.jpg': SNEASEL.file, '/switcher.jpg': SWITCHER.file, '/english.jpg': 'english-card.jpg' };
    server = http.createServer((req, res) => {
      const file = files[req.url.split('?')[0]];
      if (file) {
        const body = fs.readFileSync(path.join(FIX, file));
        res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': body.length });
        res.end(body);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/lot`;

    const launch = () => chromium.launchPersistentContext(PROFILE, {
      headless: false,
      viewport: { width: 1200, height: 800 },
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-sandbox'],
    });
    // A worker starts loading the Japanese catalog as soon as its models are up, which is before any route can be set on a
    // new browser, so that load would reach the real release URL. Start once with the switch off and stop; the real run then
    // starts with the load skipped and the test switches it on after the routes exist.
    const first = await launch();
    const firstWorker = first.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'))
      || await first.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith('chrome-extension://'), timeout: 30_000 });
    const firstPage = await first.newPage();
    await firstPage.goto(`chrome-extension://${new URL(firstWorker.url()).hostname}/options.html`);
    await firstPage.evaluate(() => chrome.storage.local.set({ japaneseCards: false }));
    await first.close();

    context = await launch();

    // The same pinned-hash path the product uses: the release URL answers with the real file.
    await context.route(CATALOG_URL, (route) => {
      requested.push('catalog-ja');
      return route.fulfill({ status: 200, contentType: 'application/gzip', body: fs.readFileSync(REAL_CATALOG) });
    });
    const prices = JSON.parse(fs.readFileSync(path.join(FIX, 'prices.json'), 'utf8'));
    await context.route('https://tcgcsv.com/tcgplayer/85/*/prices', (route) => {
      const group = new URL(route.request().url()).pathname.split('/')[3];
      requested.push(`prices-${group}`);
      return prices[group]
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prices[group]) })
        : route.fulfill({ status: 404, body: 'no fixture for this group' });
    });
    await context.route('https://tcgplayer-cdn.tcgplayer.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: thumb }));

    await context.addInitScript(() => {
      if (!location.href.startsWith('chrome-extension://')) return;
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__scans = [];
      chrome.runtime.sendMessage = async (...a) => {
        const reply = await orig(...a);
        if (a[0]?.action === 'scanPage') window.__scans.push(JSON.parse(JSON.stringify(reply)));
        return reply;
      };
    });
    const isExt = (w) => w.url().startsWith('chrome-extension://');
    worker = context.serviceWorkers().find(isExt) || await context.waitForEvent('serviceworker', { predicate: isExt, timeout: 30_000 });
    extensionId = new URL(worker.url()).hostname;
    worker.on('console', (m) => workerLogs.push(m.text()));
    host = await context.newPage();
    await host.goto(`chrome-extension://${extensionId}/options.html`);
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  });

  async function openPopup() {
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/popup.html'), timeout: 15_000 });
    await host.evaluate(async () => { await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 500, height: 900, focused: false }); });
    const popup = await opened;
    await popup.waitForFunction(() => {
      const o = document.getElementById('setup-overlay');
      return !document.getElementById('btn-scan')?.disabled || (o && o.style.display === 'flex');
    });
    expect(await popup.locator('#btn-scan').isEnabled(), 'the profile must already hold the models').toBe(true);
    for (const id of ['#btn-wiz-skip', '#btn-wiz-access-skip']) if (await popup.locator(id).isVisible()) await popup.locator(id).click();
    return popup;
  }

  async function scan(popup, page) {
    const before = await popup.evaluate(() => window.__scans.length);
    await page.bringToFront();
    await popup.locator('#btn-scan').evaluate((b) => b.click());
    await popup.waitForFunction((n) => window.__scans.length > n, before, { timeout: 120_000 });
    return popup.evaluate(() => window.__scans.at(-1));
  }

  const firstId = (card) => card.candidates?.[0]?.id;

  test('Japanese cards are asked about, picked, priced and exported; the switch turns it off', async () => {
    test.skip(Boolean(skip), skip);
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    // The switch starts off (see beforeAll). Switch it on; the first search or scan after that starts the download in the
    // background, so wait until the typed search finds a Japanese card before scanning.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const toggle = options.locator('#japanese-cards');
    expect(await toggle.isChecked(), 'the switch starts off').toBe(false);
    await options.locator('#advanced-settings > summary').click();
    await options.locator('label[for="japanese-cards"]').click();
    await expect(toggle).toBeChecked();
    await options.waitForTimeout(300);
    await options.close();
    await expect.poll(() => host.evaluate(async () => {
      const found = await chrome.runtime.sendMessage({ action: 'findCards', query: 'Hisuian Sneasel', japanese: true });
      return (found?.cards || []).some((c) => c.id === 'jp-569885');
    }), { timeout: 120_000, intervals: [1000], message: 'the catalog never loaded' }).toBe(true);

    const popup = await openPopup();
    const result = await scan(popup, page);
    // The "is this a card" check is on (the shipped one), so a hidden Japanese picture would show as notCard below.
    expect(workerLogs.filter((l) => /packaged card check not available/.test(l)), 'the card check failed to load').toEqual([]);
    expect(workerLogs.some((l) => l.includes('card check: packaged')), 'the shipped card check is in use').toBe(true);
    fs.writeFileSync(path.join(OUT, 'scan-on.json'), JSON.stringify(result.cards.map((c) => ({ ...c, crop: undefined })), null, 1));
    test.info().annotations.push({
      type: 'check model',
      description: JSON.stringify(result.cards.map((c) => ({ notCard: Boolean(c.notCard), japanese: Boolean(c.japanese), abstain: c.abstain, first: firstId(c) ?? c.identity?.id }))),
    });
    await page.screenshot({ path: path.join(OUT, 'page.png') });
    await popup.screenshot({ path: path.join(OUT, 'popup-on.png'), fullPage: true });

    expect(requested, 'the catalog came through the release URL').toContain('catalog-ja');
    expect(result.cards.filter((c) => c.notCard), 'the is-this-a-card check hid a card').toEqual([]);
    expect(result.cards.length).toBe(3);

    const japanese = result.cards.filter((c) => c.japanese);
    expect(japanese.map(firstId).sort()).toEqual([SNEASEL.id, SWITCHER.id].sort());
    for (const card of japanese) {
      expect(card.identity).toBeNull();
      expect(card.abstain).toBe(true);
      expect(card.market_price).toBeNull();
      expect(card.candidates[0].set.endsWith('(Japanese)')).toBe(true);
    }
    const english = result.cards.find((c) => !c.japanese);
    expect(english, 'the English card is not flagged').toBeTruthy();
    fs.writeFileSync(path.join(OUT, 'english-read.json'), JSON.stringify({ identity: english.identity, abstain: english.abstain, confidence: english.confidence, candidates: english.candidates?.map((c) => c.id) }));

    // The rows: two questions with the Japanese reason, no confirmed price.
    const asking = popup.locator('.choose-row');
    await expect(asking).toHaveCount(2 + (english.abstain ? 1 : 0));
    await expect(popup.locator('.choose-row .picker-sub').filter({ hasText: /Japanese/i })).toHaveCount(2);
    for (const row of await popup.locator('.choose-row').all()) {
      const sub = await row.locator('.picker-sub').innerText();
      // A Choose row may show the best match's price, always marked unconfirmed (same as an English row); never a plain quote.
      if (/Japanese/i.test(sub)) {
        const priceText = await row.locator('.card-price').innerText();
        if (/\$\d/.test(priceText)) expect(priceText, 'a price on a question row is marked unconfirmed').toContain('unconfirmed');
      }
    }

    // Pick the first candidate of one Japanese card.
    const picked = firstId(japanese[0]) === SNEASEL.id ? SNEASEL : SWITCHER;
    const other = picked === SNEASEL ? SWITCHER : SNEASEL;
    const pickedIdx = result.cards.indexOf(japanese.find((c) => firstId(c) === picked.id));
    await popup.locator(`button[data-pick="${picked.id}"][data-idx="${pickedIdx}"]`).evaluate((b) => b.click());
    const row = popup.locator(`#card-row-${pickedIdx}`);
    await expect(row).toContainText(picked.name, { timeout: 30_000 });
    await expect(row).toContainText(`$${picked.price}`, { timeout: 30_000 });
    await expect(row).toContainText(picked.number.split('/')[0].replace(/^0+/, ''));
    await popup.screenshot({ path: path.join(OUT, 'popup-picked.png'), fullPage: true });
    // The price cell's tooltip names the source ("Near Mint · TCGPlayer · ...").
    await expect(row.locator('.card-price')).toHaveAttribute('title', /TCGPlayer/);

    // The export row says what the price is.
    const download = popup.waitForEvent('download', { timeout: 15_000 });
    await popup.locator('[data-lot-csv]').evaluate((b) => b.click());
    const csv = fs.readFileSync(await (await download).path(), 'utf8');
    fs.writeFileSync(path.join(OUT, 'lot.csv'), csv);
    const line = csv.split(/\r?\n/).find((l) => l.includes(picked.name));
    expect(line, csv).toBeTruthy();
    expect(line).toContain('raw, Japanese, Near Mint');

    // The picker search finds the other Japanese card, by name and by number.
    const otherIdx = result.cards.indexOf(japanese.find((c) => firstId(c) === other.id));
    const otherRow = popup.locator(`.choose-row[data-idx="${otherIdx}"]`);
    await otherRow.locator('[data-open-search]').evaluate((b) => b.click());
    const input = popup.locator(`.picker-input[data-idx="${otherIdx}"]`);
    for (const query of [other.name, other.number.split('/')[0].replace(/^0+/, '')]) {
      await input.fill(query);
      await expect(popup.locator(`.picker-results[data-idx="${otherIdx}"] button[data-pick="${other.id}"]`), `search "${query}"`).toHaveCount(1, { timeout: 10_000 });
    }

    // Switch it off: the same page is no longer read as Japanese.
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html`);
    await settings.locator('#advanced-settings > summary').click();
    await settings.locator('label[for="japanese-cards"]').click();
    await expect(settings.locator('#japanese-cards')).not.toBeChecked();
    await settings.waitForTimeout(500);
    await settings.close();
    const off = await scan(popup, page);
    fs.writeFileSync(path.join(OUT, 'scan-off.json'), JSON.stringify(off.cards.map((c) => ({ ...c, crop: undefined })), null, 1));
    expect(off.cards.filter((c) => c.japanese)).toEqual([]);
    expect(off.cards.some((c) => (firstId(c) ?? '').startsWith('jp-') || (c.identity?.id ?? '').startsWith('jp-'))).toBe(false);
    // The English card reads the same with the switch on and off (the third picture in both scans).
    const englishOff = off.cards.find((c) => Math.abs(c.box[0] - english.box[0]) < 3);
    expect(englishOff, 'the English card is in the second scan').toBeTruthy();
    expect(englishOff.identity?.id).toBe(english.identity?.id);
    expect(englishOff.abstain).toBe(english.abstain);
    expect(Boolean(englishOff.japanese)).toBe(false);
    await popup.screenshot({ path: path.join(OUT, 'popup-off.png'), fullPage: true });
    await popup.close();
    await page.close();
  });
});
