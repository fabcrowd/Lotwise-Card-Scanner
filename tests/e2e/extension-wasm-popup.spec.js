/**
 * Live load of the consumer extension (dist/extension-wasm).
 * Confirms the popup a buyer sees actually opens, and that the service worker starts.
 *
 * Run: npx playwright test extension-wasm-popup --project=extension
 */

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '../../dist/extension-wasm');

test.describe('Consumer extension popup', () => {
  let context;
  let extensionId;

  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-sandbox',
      ],
    });

    let worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', {
        predicate: (w) => w.url().startsWith('chrome-extension://'),
        timeout: 15_000,
      });
    }
    extensionId = new URL(worker.url()).hostname;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('popup opens with a scan button and an era picker', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(page.locator('.logo')).toContainText('Sweep');
    await expect(page.locator('#btn-label')).toHaveText('SCAN PAGE');
    await expect(page.locator('.action-bar #era-select')).toBeVisible();
    // The scan button follows the background's readiness (models downloaded), which the popup asks for after it
    // loads. Ask the same question, then wait for the button to settle to that answer instead of sampling it early.
    const ready = await page.evaluate(async () => Boolean((await chrome.runtime.sendMessage({ action: 'checkReady' }))?.ready));
    if (ready) await expect(page.locator('#btn-scan')).toBeEnabled();
    else {
      await expect(page.locator('#btn-scan')).toBeDisabled();
      await expect(page.locator('#setup-overlay')).toBeVisible();
    }
    const paint = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      wizard: getComputedStyle(document.getElementById('setup-overlay')).display,
      wizardText: document.getElementById('setup-overlay').innerText.slice(0, 180),
    }));
    expect(paint.background).toBe('rgb(243, 243, 247)');
    if (paint.wizard !== 'none') {
      expect(paint.wizardText).toMatch(/Set up Sweep|Sharper photos|Unlock full prices/);
    }
    expect(errors, errors.join('\n')).toEqual([]);

    // The real window is a narrow popup. The era picker and scan button have to fit.
    await page.setViewportSize({ width: 420, height: 640 });
    const fit = await page.evaluate(() => {
      const era = document.getElementById('era-select').getBoundingClientRect();
      const scan = document.getElementById('btn-scan').getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        eraRight: era.right,
        scanRight: scan.right,
      };
    });
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth + 1);
    expect(fit.eraRight).toBeLessThanOrEqual(420);
    expect(fit.scanRight).toBeLessThanOrEqual(420);

    await page.screenshot({
      path: path.join(__dirname, 'screenshots', 'ext-wasm-popup.png'),
    });
    await page.close();
  });

  test('a card photo that is still loading is reported, then found', async () => {
    const listing = await context.newPage();
    let releaseImage;
    const imageHeld = new Promise((resolve) => { releaseImage = resolve; });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await listing.route('http://127.0.0.1:8765/**', async (route) => {
      if (route.request().url().endsWith('.png')) {
        await imageHeld;
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>lot</title><img width="220" height="310" alt="Charizard" src="http://127.0.0.1:8765/card.png">',
      });
    });
    await listing.goto('http://127.0.0.1:8765/lot', { waitUntil: 'domcontentloaded' });

    const worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    const ask = () => worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.startsWith('http://127.0.0.1:8765/lot'));
      if (!tab) return { error: 'no tab' };
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      const found = await chrome.tabs.sendMessage(tab.id, { action: 'findCards' });
      return { cards: found.cards?.length ?? 0, pending: found.pending ?? 0 };
    });

    const whileLoading = await ask();
    expect(whileLoading.cards).toBe(0);
    expect(whileLoading.pending).toBeGreaterThan(0);

    releaseImage();
    await listing.waitForFunction(() => {
      const img = document.querySelector('img');
      return img && img.complete && img.naturalWidth > 0;
    });
    const loaded = await ask();
    expect(loaded.cards).toBe(1);
    expect(loaded.pending).toBe(0);
    await listing.close();
  });

  test('a screenshot scan offers site access; Allow offers a rescan, Not now is remembered', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // The dev build holds <all_urls> already, so pretend it is missing; the click handler is the real one.
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => (msg?.action === 'scanPage'
        ? { cards: [], scanId: 'x', srcWidth: 10, srcHeight: 10, pending: 0, usedScreenshotPath: true, reason: 'no-site-access' }
        : real(msg));
      window.__granted = false;
      window.__asked = [];
      chrome.permissions.contains = async () => window.__granted;
      chrome.permissions.request = async (req) => { window.__asked.push(req); return window.__granted = true; };
      chrome.storage.local.remove('siteAccessDismissedAt');
    });
    // The fresh profile has no models, so the setup overlay covers the button; click it directly.
    const scan = () => page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    const notice = page.locator('#access-notice');

    await scan();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('It finds more cards.');
    await expect(page.locator('button#access-allow')).toBeVisible();
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'ext-wasm-popup-site-access.png') });

    await page.locator('#access-allow').evaluate((b) => b.click());
    expect(await page.evaluate(() => window.__asked)).toEqual([{ origins: ['<all_urls>'] }]);
    await expect(page.locator('#access-outcome')).toContainText('scan again to read the original photos');
    await expect(page.locator('#access-rescan')).toBeVisible();

    await page.evaluate(() => { window.__granted = false; });
    await scan();
    await expect(notice).toBeVisible();
    await page.locator('#access-skip').evaluate((b) => b.click());
    await expect(notice).toBeHidden();
    await scan();
    await expect(page.locator('#msg-bar')).toContainText('No Pok');
    await expect(notice).toBeHidden();
    await page.close();
  });

  test('a lot of 3+ cards shows an estimate, and an unrecognised card asks with its closest matches', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__highlights = [];
      const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
      const near = [{ id: 'a-1', name: 'Pidgey', set: 'Set A', setCode: 'a', number: '1' }, { id: 'b-2', name: 'Rattata', set: 'Set B', setCode: 'b', number: '2' }];
      const crop = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      const cards = [
        { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), box: [0, 0, 1, 1] },
        { identity: { id: 'x-2', name: 'Raichu', set: 'Base', setCode: 'base1', number: '14' }, confidence: 0.9, abstain: false, market_price: 7.5, price_grid: grid(7.5), box: [0, 0, 1, 1] },
        { identity: null, confidence: 0.3, abstain: true, candidates: near, crop, box: [0, 0, 1, 1] },
      ];
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action === 'scanPage') return { cards, scanId: 'y', srcWidth: 10, srcHeight: 10, pending: 0 };
        if (msg?.action === 'highlightCard') { window.__highlights.push(msg); return { ok: true }; }
        return real(msg);
      };
    });
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    await expect(page.locator('#s-value')).toHaveText('$12.50');
    await expect(page.locator('#s-value')).toHaveAttribute('title', '2 of 3 cards identified · 1 still to identify');
    await expect(page.locator('#stat-value')).toHaveAttribute('aria-label', '2 of 3 cards identified · 1 still to identify');
    // The card to choose comes first, under "To confirm"; confirmed rows follow.
    await expect(page.locator('.card-price')).toHaveText(['no price', '$5.00', '$7.50']);
    await expect(page.locator('.card-row .picker-title')).toHaveText('Which card is this?');
    await expect(page.locator('.picker-sub')).toHaveText('Closest matches, best one first');
    await expect(page.locator('.pick-card')).toHaveCount(2);
    await expect(page.locator('.unrec-toggle')).toHaveCount(0);

    const scanned = page.locator('.card-row.asking .scanned-card');
    await expect(scanned).toHaveCount(1);
    await expect(scanned.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(scanned).toContainText('On the page');
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'ext-wasm-popup-ask.png') });
    await scanned.evaluate((b) => b.click());
    const sent = await page.evaluate(() => window.__highlights);
    expect(sent.at(-1)).toEqual({ action: 'highlightCard', index: 2, scroll: true });
    await page.close();
  });

  test('a set the page heading names is priced and marked; confirming it saves the answer and keeps the Set? menu', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__sent = [];
      const cards = [{
        identity: { id: 'sv02-5', name: 'Eevee', set: 'Paldea Evolved', setCode: 'sv02', number: '005' },
        setChoices: [
          { id: 'sv01-5', name: 'Eevee', set: 'Scarlet & Violet', setCode: 'sv01', number: '005' },
          { id: 'sv02-5', name: 'Eevee', set: 'Paldea Evolved', setCode: 'sv02', number: '005' },
        ],
        setConfirmed: false,
        bestGuess: { source: 'hint', reason: 'Page says Paldea Evolved' },
        confidence: 0.7, abstain: false, market_price: 3, box: [0, 0, 1, 1],
        price_grid: { source: 'pokemontcg', variants: { normal: { market: 3, conditions: { NM: 3 } } } },
      }];
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action === 'scanPage') return { cards, scanId: 'g', srcWidth: 10, srcHeight: 10, pending: 0 };
        if (msg?.action === 'saveCorrection') { window.__sent.push(msg); return { ok: true }; }
        return real(msg);
      };
    });
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });

    const mark = page.locator('.card-row .guess-mark');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute('title', 'Page says Paldea Evolved');
    await expect(page.locator('.set-select-row [role="radio"][aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'sv02-5');
    await expect(page.locator('#s-value')).toHaveText('$3.00');
    await expect(page.locator('.card-row .card-price')).toHaveText('$3.00');

    await mark.evaluate((b) => b.click());
    await expect(page.locator('.card-row .guess-mark')).toHaveCount(0);
    await expandRow(page);
    await expect(page.locator('.set-select-row [role="radio"][aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'sv02-5');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', scanId: 'g', index: 0, pickedId: 'sv02-5', via: 'guess-confirmed' });
    await page.close();
  });

  // Opens a fresh popup whose scan returns the cards built by `build` (run inside the page).
  async function popupWithScan(build) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate((src) => {
      const cards = new Function(`return (${src})()`)();
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => (msg?.action === 'scanPage'
        ? { cards, scanId: 'z', srcWidth: 10, srcHeight: 10, pending: 0 }
        : real(msg));
    }, build.toString());
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    return page;
  }

  // Settled priced rows are one line until opened (spec 12): open one before acting on its details. A row that has just
  // been picked collapses once its price lands, so this waits a moment for the collapsed row; a row that is already open is left alone.
  async function expandRow(page, idx = 0) {
    const toggle = page.locator(`.card-row.is-collapsed[data-idx="${idx}"] .row-toggle`);
    await toggle.waitFor({ timeout: 1500 }).catch(() => {});
    if (await toggle.count()) await toggle.evaluate((b) => b.click()); // the setup overlay may sit over the list in a fresh profile
  }

  test('a set borrowed from the other cards on the page is a range with the Set? menu preselected until confirmed', async () => {
    const page = await popupWithScan(() => [{
      identity: { id: 'sv02-5', name: 'Eevee', set: 'Paldea Evolved', setCode: 'sv02', number: '005' },
      setChoices: [
        { id: 'sv01-5', name: 'Eevee', set: 'Scarlet & Violet', setCode: 'sv01', number: '005' },
        { id: 'sv02-5', name: 'Eevee', set: 'Paldea Evolved', setCode: 'sv02', number: '005' },
      ],
      setConfirmed: false,
      setRange: { low: 2, high: 9, count: 2, total: 2 },
      bestGuess: { source: 'page', reason: 'likely Paldea Evolved: 2 other cards on this page are from it' },
      confidence: 0.7, abstain: false, market_price: 3, box: [0, 0, 1, 1],
      price_grid: { source: 'pokemontcg', variants: { normal: { market: 3, conditions: { NM: 3 } } } },
    }]);
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00–$9.00');
    await expect(page.locator('.set-select-row [role="radio"][aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'sv02-5');
    await expect(page.locator('.card-row .guess-mark')).toHaveCount(1);
    await page.locator('.card-row .guess-mark').evaluate((b) => b.click());
    await expect(page.locator('.card-row .card-price')).toHaveText('$3.00');
    await page.close();
  });

  test('the ? beside the finish chips confirms the suggested printing: no price until then, then one price', async () => {
    const page = await popupWithScan(() => [{
      identity: { id: 'x-1', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51' },
      confidence: 0.9, abstain: false, box: [0, 0, 1, 1],
      variant: { edition: 'standard', finish: 'reverse', stamp: 'none' },
      price_grid: { source: 'pokemontcg', variants: {
        normal: { market: 2, conditions: { NM: 2 } },
        holofoil: { market: 10, conditions: { NM: 10 } },
        reverseHolofoil: { market: 4, conditions: { NM: 4 } },
      } },
    }]);
    const suggestedChip = page.locator('.variant-select-row:not(.set-select-row) .chip-suggested');
    await expect(suggestedChip).toHaveAttribute('data-strip-pick', 'reverseHolofoil');
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00–$10.00');
    await expect(page.locator('#s-value')).toHaveText('$2.00–$10.00');
    const confirm = page.locator('button[data-variant-confirm]');
    await expect(confirm).toHaveCount(1);
    await expect(confirm).toHaveAttribute('aria-label', /Suggested version Reverse Holo/);
    await confirm.evaluate((b) => b.click());
    await expect(page.locator('button[data-variant-confirm]')).toHaveCount(0);
    await expect(page.locator('.card-row .card-price')).toHaveText('$4.00');
    await expect(page.locator('#s-value')).toHaveText('$4.00');
    await expect(page.locator('#lot-edition')).toBeHidden();
    await page.close();
  });

  test('the lot summary counts the cards still to confirm next to the sure total', async () => {
    const page = await popupWithScan(() => {
      const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
      return [
        { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), box: [0, 0, 1, 1] },
        { identity: null, confidence: 0.3, abstain: true, candidates: [{ id: 'a', name: 'Mew', set: 'Fossil', setCode: 'base3', number: '8' }], box: [0, 0, 1, 1] },
        { identity: null, confidence: 0.2, abstain: true, box: [0, 0, 1, 1] },
        { cardBack: true, box: [0, 0, 1, 1] },
      ];
    });
    const totals = page.locator('#lot-totals');
    await expect(totals).toBeVisible();
    await expect(totals.locator('.lt-item').first()).toContainText('Confirmed value $5.00 · 1 card');
    const toConfirm = totals.locator('.lt-guess');
    await expect(toConfirm).toContainText('To confirm');
    await expect(toConfirm.locator('b')).toHaveText('2');
    await expect(toConfirm).toHaveAttribute('title', /Confirm each card to see its price/);
    await page.close();
  });

  test('the lot summary says how many confirmed cards have no price data', async () => {
    const page = await popupWithScan(() => {
      const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
      return [
        { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), box: [0, 0, 1, 1] },
        { identity: { id: 'x-8', name: 'Machamp', set: 'Base', setCode: 'base1', number: '8' }, confidence: 0.9, abstain: false, market_price: null, price_grid: null, box: [0, 0, 1, 1] },
      ];
    });
    const sure = page.locator('#lot-totals .lt-item').first();
    await expect(sure).toContainText('Confirmed value $5.00 · 2 cards · 1 without price');
    await expect(sure.locator('.lt-n')).toHaveAttribute('title', '1 confirmed card has no price data');
    await page.close();
  });

  const exportLot = () => {
    const grid = (nm) => ({ source: 'pokemontcg', updatedAt: new Date().toISOString(), variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const pika = { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), box: [0, 0, 1, 1] };
    return [
      pika,
      { ...pika, box: [0, 0, 1, 1] },
      { identity: { id: 'x-2', name: 'Farfetch\'d, "Ash"', set: 'Jungle', setCode: 'base2', number: '27' }, confidence: 0.9, abstain: false, market_price: 3, price_grid: grid(3), box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.3, abstain: true, candidates: [{ id: 'a', name: 'Mew', set: 'Fossil', setCode: 'base3', number: '8' }], box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.2, abstain: true, box: [0, 0, 1, 1] },
    ];
  };

  test('the lot strip offers Copy and CSV for the confirmed cards, with a tooltip for the rest', async () => {
    const page = await popupWithScan(exportLot);
    const copy = page.locator('#lot-totals [data-lot-copy]');
    const csv = page.locator('#lot-totals [data-lot-csv]');
    await expect(copy).toHaveText('Copy list (3)');
    await expect(csv).toHaveText('Download CSV (3)');
    await expect(copy).toHaveAttribute('aria-label', 'Copy list (3)');
    await expect(csv).toHaveAttribute('aria-label', 'Download CSV (3)');
    await expect(copy).toHaveAttribute('title', '2 more cards still need confirming and are not included');
    await expect(csv).toHaveAttribute('title', '2 more cards still need confirming and are not included');
    await copy.focus();
    await expect(copy).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(csv).toBeFocused();
    await page.close();
  });

  test('with no confirmed card the lot strip has no export buttons', async () => {
    const page = await popupWithScan(() => [
      { identity: null, confidence: 0.3, abstain: true, candidates: [{ id: 'a', name: 'Mew', set: 'Fossil', setCode: 'base3', number: '8' }], box: [0, 0, 1, 1] },
    ]);
    await expect(page.locator('#lot-totals')).toBeVisible();
    await expect(page.locator('#lot-totals [data-lot-copy], #lot-totals [data-lot-csv]')).toHaveCount(0);
    await page.close();
  });

  test('Copy puts a tab-separated block on the clipboard and says how many cards', async () => {
    const page = await popupWithScan(exportLot);
    await page.evaluate(() => {
      window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
    });
    await page.locator('[data-lot-copy]').evaluate((b) => b.click());
    await expect(page.locator('#msg-bar')).toHaveText('Copied 3 cards · $13.00 · 2 unconfirmed left out');
    const text = await page.evaluate(() => window.__copied);
    const lines = text.split('\n').filter(Boolean);
    expect(lines[0]).toBe('Name\tSet\tNumber\tPrinting\tFinish\tCondition\tQty\tPrice\tLow\tHigh\tPrice source\tPrice date\tPrice age days\tBasis');
    expect(lines).toHaveLength(3);
    const pika = lines[1].split('\t');
    expect(pika.slice(0, 3)).toEqual(['Pikachu', 'Base', '58']);
    expect(pika[5]).toBe('NM');
    expect(pika[6]).toBe('2');
    expect(pika[7]).toBe('5.00');
    expect(pika[13]).toBe('raw, English, Near Mint');
    expect(text).not.toMatch(/Mew|http/);
    await page.close();
  });

  test('a refused clipboard write falls back to the textarea copy and still reports; both failing says use CSV', async () => {
    const page = await popupWithScan(exportLot);
    await page.evaluate(() => {
      window.__fallback = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
      document.execCommand = (cmd) => { window.__fallback = document.activeElement?.tagName === 'TEXTAREA' ? document.activeElement.value : 'no textarea'; return cmd === 'copy'; };
    });
    await page.locator('[data-lot-copy]').evaluate((b) => b.click());
    await expect(page.locator('#msg-bar')).toHaveText('Copied 3 cards · $13.00 · 2 unconfirmed left out');
    expect(await page.evaluate(() => window.__fallback)).toMatch(/^Name\tSet\tNumber/);
    await expect(page.locator('textarea')).toHaveCount(0);
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.locator('[data-lot-copy]').evaluate((b) => b.click());
    await expect(page.locator('#msg-bar')).toHaveText('Copy failed: use Download CSV');
    await page.close();
  });

  test('Download CSV saves card-lot-DATE.csv as UTF-8 with a BOM and CRLF line endings', async () => {
    const page = await popupWithScan(exportLot);
    await page.evaluate(() => {
      window.__download = null;
      window.HTMLAnchorElement.prototype.click = function click() {
        window.__download = { name: this.download, href: this.href };
        fetch(this.href).then((r) => r.arrayBuffer()).then((b) => { window.__download.bytes = Array.from(new Uint8Array(b)); });
      };
    });
    await page.locator('[data-lot-csv]').evaluate((b) => b.click());
    await page.waitForFunction(() => window.__download?.bytes);
    const file = await page.evaluate(() => window.__download);
    expect(file.name).toMatch(/^card-lot-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.href).toMatch(/^blob:/);
    expect(file.bytes.slice(0, 3)).toEqual([0xEF, 0xBB, 0xBF]);
    const text = Buffer.from(file.bytes.slice(3)).toString('utf8');
    expect(text.startsWith('Name,Set,Number,Printing')).toBe(true);
    expect(text.split('\r\n')).toHaveLength(4);
    expect(text).not.toMatch(/(^|[^\r])\n/);
    expect(text).toContain('"Farfetch\'d, ""Ash"""');
    await expect(page.locator('#msg-bar')).toContainText('Saved 3 cards as card-lot-');
    await page.close();
  });

  test('the est. value header and the lot strip say the prices are Near Mint', async () => {
    const page = await popupWithScan(exportLot);
    const tip = 'Prices are Near Mint market prices unless your price-service key provides other conditions';
    await expect(page.locator('#s-cond')).toHaveText('NM');
    await expect(page.locator('#s-cond')).toHaveAttribute('title', tip);
    await expect(page.locator('#lot-totals .lt-cond')).toHaveText('Near Mint');
    await expect(page.locator('#lot-totals .lt-cond')).toHaveAttribute('title', tip);
    await page.locator('#btn-clear').evaluate((b) => b.click());
    await expect(page.locator('#s-cond')).toBeHidden();
    await page.close();
  });

  test('Clear returns the popup to its empty state: no lot line, groups, or value', async () => {
    const page = await popupWithScan(() => [
      { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false, market_price: 5,
        price_grid: { source: 'pokemontcg', variants: { normal: { market: 5, conditions: { NM: 5 } } } }, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.3, abstain: true, candidates: [{ id: 'a', name: 'Mew', set: 'Fossil', setCode: 'base3', number: '8' }], box: [0, 0, 1, 1] },
    ]);
    await expect(page.locator('#lot-totals')).toBeVisible();
    await expect(page.locator('#results .card-row, #results .choose-group').first()).toBeVisible();
    await page.locator('#btn-clear').evaluate((b) => b.click());
    await expect(page.locator('#lot-totals')).toBeHidden();
    await expect(page.locator('#lot-totals')).toHaveText('');
    await expect(page.locator('#lot-edition')).toBeHidden();
    await expect(page.locator('#fullsize-notice')).toBeHidden();
    await expect(page.locator('#results .card-row')).toHaveCount(0);
    await expect(page.locator('#results .choose-group, #results [data-review-all]')).toHaveCount(0);
    await expect(page.locator('#s-value')).toHaveText('—');
    await expect(page.locator('#empty-hint')).toBeVisible();
    await page.close();
  });

  test('one Base Set edition for the lot applies to every row not picked individually', async () => {
    const page = await popupWithScan(() => {
      const row = (n) => ({ market: n, conditions: { NM: n } });
      const baseHolo = (id, name, number) => ({
        identity: { id, name, set: 'Base Set', setCode: 'base1', number },
        confidence: 0.9, abstain: false, box: [0, 0, 1, 1],
        finishSure: 'holofoil', variant: { edition: null, finish: 'holofoil', stamp: 'none' },
        price_grid: { source: 'pokemontcg', variants: { unlimitedHolofoil: row(40), shadowlessHolofoil: row(300), '1stEditionHolofoil': row(3000) } },
      });
      return [
        baseHolo('base1-4', 'Charizard', '4'),
        baseHolo('base1-2', 'Blastoise', '2'),
        { identity: { id: 'x-1', name: 'Pikachu', set: 'Jungle', setCode: 'base2', number: '60' }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1],
          price_grid: { source: 'pokemontcg', variants: { normal: row(5) } } },
      ];
    });
    const prices = page.locator('.card-row .card-price');
    await expect(prices).toHaveText(['$40.00–$3000.00', '$40.00–$3000.00', '$5.00']);
    const lot = page.getByLabel('Base Set editions', { exact: true }).locator('select');
    await expect(lot).toBeVisible();
    await expect(lot.locator('option')).toHaveText(['All Base Set cards are…', 'Unlimited', 'Shadowless', '1st Edition']);

    // The second row is set on its own first; the lot choice must leave it alone.
    await page.locator('.card-row[data-idx="1"] .chip[data-strip-pick="1stEditionHolofoil"]').evaluate((b) => b.click());
    await expect(prices).toHaveText(['$40.00–$3000.00', '$3000.00', '$5.00']);

    // Keyboard reachable: focus the control and change it with the arrow keys.
    await lot.focus();
    await page.keyboard.press('ArrowDown');
    await expect(lot).toHaveValue('unlimited');
    await expect(prices).toHaveText(['$40.00', '$3000.00', '$5.00']);
    await expandRow(page, 0);
    await expect(page.locator('.card-row[data-idx="0"] .chip[aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'unlimitedHolofoil');

    await lot.selectOption('shadowless');
    await expect(prices).toHaveText(['$300.00', '$3000.00', '$5.00']);
    await page.close();
  });

  // ─── Choose flow: two states only, confirmed or choose ───

  const SHOTS = path.resolve(__dirname, '../../.tmp/choose-flow');

  // Real pictures for the crop and the card art, so screenshots show what the list looks like.
  async function swatch(color, format) {
    const image = sharp({ create: { width: 126, height: 176, channels: 3, background: color } });
    const buffer = format === 'png' ? await image.png().toBuffer() : await image.jpeg().toBuffer();
    return `data:image/${format};base64,${buffer.toString('base64')}`;
  }

  // Opens a popup whose scan returns { cards, priced } built by `build(crop, arts)` inside the page.
  // Records saveCorrection and overlay pushes; priceCard answers from `priced`.
  async function popupWithChoose(build, saveResp = { ok: true }, { tabUrl = null, autoScan = true } = {}) {
    const crop = await swatch('#8855cc', 'jpeg');
    const arts = await Promise.all(['#cc5555', '#55aa66', '#5577cc', '#ccaa44', '#aa55aa'].map((c) => swatch(c, 'png')));
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 720 });
    // The popup is a tab here, so the page it is "about" is stated: the saved lot is kept per page.
    await page.addInitScript((url) => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => (msg?.action === 'scanState' && url ? { tabUrl: url, running: false } : real(msg));
    }, tabUrl);
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(({ src, crop, arts, saveResp }) => {
      const { cards, priced, found, rescan } = new Function(`return (${src})`)()(crop, arts);
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__sent = [];
      window.__overlay = [];
      window.__priceCalls = [];
      let scans = 0;
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action === 'scanPage') { scans += 1; return { cards: scans > 1 && rescan ? rescan : cards, scanId: 'c', srcWidth: 10, srcHeight: 10, pending: 0 }; }
        if (msg?.action === 'saveCorrection' || msg?.action === 'saveSkip' || msg?.action === 'unskip') { window.__sent.push(msg); return msg.action === 'saveCorrection' ? saveResp : { ok: true }; }
        if (msg?.action === 'findCards') return { cards: found || [] };
        if (msg?.action === 'priceCard') { window.__priceCalls.push(msg.id); return priced[msg.id] || { error: 'no price' }; }
        if (msg?.action === 'overlayWithGrid') { window.__overlay.push(msg); return { ok: true }; }
        if (msg?.action === 'highlightCard') return { ok: true };
        return real(msg);
      };
    }, { src: build.toString(), crop, arts, saveResp });
    // The fresh profile has no models, so the popup's start-up check opens the setup wizard, a few ms after load or
    // not at all; a stylesheet keeps it out of the way whenever that happens (an inline display:none raced it).
    await page.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
    if (autoScan) await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    return page;
  }

  // Two confirmed cards and four to choose: #2 has a candidate matching the photo's name line (preselected over the closest),
  // #4 leads clearly, #5 and #6 are close calls (tight scores, then no scores at all).
  const chooseScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const multi = { source: 'pokemontcg', variants: {
      normal: { market: 2, conditions: { NM: 2 } },
      holofoil: { market: 10, conditions: { NM: 10 } },
    } };
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[1]);
    const c3 = row('c-3', 'Spearow', 'Jungle', 'base2', '62', arts[2]);
    const d4 = row('d-4', 'Zubat', 'Fossil', 'base3', '57', arts[3]);
    const e5 = row('e-5', 'Gastly', 'Fossil', 'base3', '50', arts[4]);
    const cards = [
      { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.3, abstain: true, candidates: [a1, b2, c3], titleContradicts: 'Rattata', crop, box: [0, 0, 1, 1] },
      { identity: { id: 'x-2', name: 'Raichu', set: 'Base', setCode: 'base1', number: '14' }, confidence: 0.9, abstain: false, market_price: 7.5, price_grid: grid(7.5), box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.2, abstain: true, candidates: [d4, e5], ranked: [{ id: 'd-4', rank: 0.9 }, { id: 'e-5', rank: 0.8 }], crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.2, abstain: true, candidates: [c3, e5], ranked: [{ id: 'c-3', rank: 0.9 }, { id: 'e-5', rank: 0.89 }], crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.2, abstain: true, candidates: [c3, b2], crop, box: [0, 0, 1, 1] },
    ];
    const priced = {
      'a-1': { identity: a1, market_price: 3, price_variant: 'normal', price_grid: multi },
      'b-2': { identity: b2, market_price: 4, price_variant: 'normal', price_grid: grid(4) },
      'c-3': { identity: c3, market_price: 6, price_variant: 'normal', price_grid: grid(6) },
      'd-4': { identity: d4, market_price: 1, price_variant: 'normal', price_grid: grid(1) },
    };
    return { cards, priced };
  };

  test('a card below the bar is a choice: its crop beside the closest cards, best preselected, no name, price marked unconfirmed', async () => {
    const page = await popupWithChoose(chooseScan);
    const group = page.locator('#results > .choose-group');
    await expect(group).toHaveCount(1);
    await expect(group.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await expect(page.locator('.choose-review')).toHaveText('Review these 4 together');
    const row = page.locator('.choose-row').first();
    await expect(row.locator('.scanned-card img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(row.locator('.pick-choice')).toHaveCount(3);
    await expect(row.locator('.pick-choice').first().locator('.pick-best')).toHaveText('Best match');
    await expect(row.locator('.pick-best')).toHaveCount(1);
    await expect(row.locator('.pick-choice').first().locator('img')).toHaveAttribute('src', /^data:image\/png/);
    // The candidate whose name matches the photo's name line is preselected: first, with the agreement mark and the best tag.
    await expect(row.locator('.pick-choice').first()).toContainText('Rattata');
    await expect(row.locator('.pick-choice').first()).toContainText('Base Set #61');
    await expect(row.locator('.pick-agree')).toHaveCount(1);
    await expect(row.locator('.pick-choice[data-pick="b-2"] .pick-agree')).toHaveCount(1);
    await expect(row.locator('.pick-choice[data-pick="b-2"] .pick-best')).toHaveCount(1);
    await expect(row.locator('.pick-choice').nth(1)).toContainText('Pidgey');
    await expect(row.locator('.card-price')).toHaveText('$4.00 · unconfirmed');
    await expect(row.locator('.card-name')).toHaveText('Card 2');
    await expect(row.locator('[data-confirm-best]')).toHaveText('Confirm Rattata');
    await expect(row.locator('[data-open-search]')).toHaveText('None of these? Search');
    await expect(page.locator('#s-value')).toHaveText('$12.50');
    // The page overlay is told: choose for the three, identified for the two, and nothing to name.
    const overlay = await page.evaluate(() => window.__overlay.at(-1).cards.map((c) => [c.display?.state, c.display?.name ?? null, c.display?.price ?? null]));
    expect(overlay).toEqual([['identified', 'Pikachu', 5], ['choose', null, null], ['identified', 'Raichu', 7.5], ['choose', null, null], ['choose', null, null], ['choose', null, null]]);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'choose-list.png') });
    await page.close();
  });

  test('confirming the preselected card saves it as before, moves the row to confirmed and shows a range until the printing is picked', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row').first().locator('[data-confirm-best]').click();
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (3)');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', scanId: 'c', index: 1, pickedId: 'b-2', via: 'candidates' });
    await expect(page.locator('.card-row[data-idx="1"] .card-price')).toHaveText('$4.00');
    await expect(page.locator('.card-row[data-idx="1"] .card-name')).toContainText('Rattata');
    await expect(page.locator('.choose-row')).toHaveCount(3);
    await page.close();
  });

  test('tapping another candidate confirms that one, with its price', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row').first().locator('.pick-choice[data-pick="a-1"]').click();
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ index: 1, pickedId: 'a-1', via: 'candidates' });
    // Pidgey has two printings: a range, not one auto-picked price.
    await expect(page.locator('.card-row[data-idx="1"] .card-price')).toHaveText('$2.00–$10.00');
    await expect(page.locator('.card-row[data-idx="1"] .card-name')).toContainText('Pidgey');
    await page.close();
  });

  test('keyboard: Tab reaches the confirm button after the candidates, Enter confirms, focus moves on to the next row to confirm', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row').first().locator('.pick-choice').first().focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('.choose-row').first().locator('[data-confirm-best]')).toBeFocused();
    await expect(page.locator('.choose-row').first().locator('[data-confirm-best]')).toHaveAccessibleName(/Confirm the best match for card 2: Rattata, Base Set, number 61/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-row[data-idx="1"] .card-name')).toContainText('Rattata');
    // The confirmed row is no longer a row to choose: focus advances to the next one's preselected Confirm button.
    const next = page.locator('.choose-row[data-idx="3"] [data-confirm-best]');
    await expect(next).toBeFocused();
    // The toast also carries a Change button (section 10, rule 5), so the text is matched as a start.
    await expect(page.locator('#msg-bar')).toHaveText(/^Confirmed Rattata\. 3 to confirm\./);
    await page.close();
  });

  test('keyboard: confirming the last row to confirm moves focus to the lot Copy button and keeps it there', async () => {
    const page = await popupWithChoose(chooseScan);
    for (const idx of [1, 3, 4, 5]) {
      const confirm = page.locator(`.choose-row[data-idx="${idx}"] [data-confirm-best]`);
      await confirm.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(`.card-row[data-idx="${idx}"] .card-price`)).toHaveText(/\$/);
    }
    await expect(page.locator('#lot-totals [data-lot-copy]')).toBeFocused();
    await expect(page.locator('#msg-bar')).toHaveText(/^Confirmed .+\. Nothing left to confirm\.(Change)?$/);
    await page.close();
  });

  test('confirming with a mouse click does not move keyboard focus around the page', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-confirm-best]').click();
    await expect(page.locator('.card-row[data-idx="1"] .card-name')).toContainText('Rattata');
    await expect(page.locator('#msg-bar')).toContainText('Confirmed Rattata');
    await page.close();
  });

  test('review all: clear matches ticked, the rest unticked and marked Check, Confirm N counts ticks, Escape closes', async () => {
    const page = await popupWithChoose(chooseScan);
    const panel = page.locator('#bulk-panel');
    await expect(panel).toBeHidden();
    await page.locator('.choose-review').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Ticked pairs look like clear matches; check the others yourself.');
    await expect(panel.locator('.bulk-pair')).toHaveCount(4);
    // Ticked: #2 (name matches the photo) and #4 (clear lead). Unticked: #5 (tight scores) and #6 (no scores).
    await expect(panel.locator('.bulk-keep:checked')).toHaveCount(2);
    await expect(panel.locator('.bulk-keep[data-idx="1"]')).toBeChecked();
    await expect(panel.locator('.bulk-keep[data-idx="3"]')).toBeChecked();
    await expect(panel.locator('.bulk-keep[data-idx="4"]')).not.toBeChecked();
    await expect(panel.locator('.bulk-keep[data-idx="5"]')).not.toBeChecked();
    await expect(panel.locator('.bulk-check')).toHaveCount(2);
    await expect(panel.locator('.bulk-pair[data-idx="4"] .bulk-check')).toHaveText('Check');
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 2');
    await expect(page.locator('#bulk-confirm')).toBeEnabled();
    await expect(panel.locator('.bulk-pair').first()).toContainText('Rattata');
    // Big enough to compare: the photo and the candidate art are at least 88 px tall.
    for (const img of await panel.locator('.bulk-pair').first().locator('.bulk-img').all()) {
      expect((await img.boundingBox()).height).toBeGreaterThanOrEqual(88);
    }
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'bulk-grid.png') });

    // Escape closes without confirming anything, and focus goes back to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('.choose-review')).toBeFocused();
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);

    await page.locator('.choose-review').click();
    await panel.locator('.bulk-keep[data-idx="4"]').check();
    await panel.locator('.bulk-keep[data-idx="3"]').uncheck();
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 2');
    await expect(panel.locator('.bulk-pair.skipped')).toHaveCount(2);
    await page.locator('#bulk-confirm').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (2)');
    await expect(page.locator('.choose-row')).toHaveCount(2);
    const sent = await page.evaluate(() => window.__sent.map((m) => [m.index, m.pickedId, m.via]));
    // Pair 1 was the scanner's own preselection (confirmed, not saved); pair 4 was a Check pair ticked by hand (saved).
    expect(sent).toEqual([[4, 'c-3', 'candidates']]);
    await expect(page.locator('.card-row[data-idx="1"] .card-price')).toHaveText('$4.00');
    await expect(page.locator('.card-row[data-idx="4"] .card-price')).toHaveText('$6.00');
    await page.close();
  });

  test('review all with nothing ticked: Confirm is disabled and says what to do', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-review').click();
    const panel = page.locator('#bulk-panel');
    await expect(panel.locator('#bulk-hint')).toBeHidden();
    await panel.locator('.bulk-keep[data-idx="1"]').uncheck();
    await panel.locator('.bulk-keep[data-idx="3"]').uncheck();
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 0');
    await expect(page.locator('#bulk-confirm')).toBeDisabled();
    await expect(panel.locator('#bulk-hint')).toBeVisible();
    await expect(panel.locator('#bulk-hint')).toHaveText('Tick the ones that look right');
    await panel.locator('.bulk-keep[data-idx="4"]').check();
    await expect(panel.locator('#bulk-hint')).toBeHidden();
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 1');
    await page.close();
  });

  // No title evidence anywhere: #1 leads on similarity score alone, #2 only differs by printing, #3 is a tight call.
  const scoreScan = (crop, arts) => {
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
    const a2 = row('a-2', 'Pidgey', 'Base Set', 'base1', '57', arts[1]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[2]);
    const c3 = row('c-3', 'Spearow', 'Jungle', 'base2', '62', arts[3]);
    const sc = (...p) => p.map(([id, score]) => ({ id, rank: score, score }));
    const cards = [
      { identity: null, confidence: 0.2, abstain: true, candidates: [a1, b2], ranked: sc(['a-1', 0.9], ['b-2', 0.8]), crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.2, abstain: true, candidates: [a1, a2], ranked: sc(['a-1', 0.9], ['a-2', 0.7]), crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.2, abstain: true, candidates: [c3, b2], ranked: sc(['c-3', 0.9], ['b-2', 0.89]), crop, box: [0, 0, 1, 1] },
    ];
    return { cards, priced: {} };
  };

  test('review all: a lead on similarity score is ticked without title evidence; a printing-only pair is not', async () => {
    const page = await popupWithChoose(scoreScan);
    await page.locator('.choose-review').click();
    const panel = page.locator('#bulk-panel');
    await expect(panel.locator('.bulk-keep:checked')).toHaveCount(1);
    await expect(panel.locator('.bulk-keep[data-idx="0"]')).toBeChecked();
    await expect(panel.locator('.bulk-pair[data-idx="0"] .bulk-check')).toHaveCount(0);
    await expect(panel.locator('.bulk-keep[data-idx="1"]')).not.toBeChecked();
    await expect(panel.locator('.bulk-pair[data-idx="1"] .bulk-check')).toHaveText('Check');
    await expect(panel.locator('.bulk-keep[data-idx="2"]')).not.toBeChecked();
    await page.close();
  });

  test('review all has no Tick all button, and a hand tick changes only the ticks; Confirm N still needs its own press', async () => {
    const page = await popupWithChoose(scoreScan);
    await page.locator('.choose-review').click();
    const panel = page.locator('#bulk-panel');
    await expect(panel.getByRole('button', { name: /tick all/i })).toHaveCount(0);
    await expect(panel.locator('.bulk-note')).toHaveText('Ticked pairs look like clear matches; check the others yourself.');
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 1');
    await panel.locator('.bulk-keep[data-idx="2"]').check();
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 2');
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    await page.close();
  });

  // Self-contained (it runs inside the page): #0 leads on score (preticked), #1 is a Check pair; both priced.
  const bulkSaveScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
    const a2 = row('a-2', 'Pidgey', 'Base Set', 'base1', '57', arts[1]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[2]);
    const sc = (...p) => p.map(([id, score]) => ({ id, rank: score, score }));
    return {
      cards: [
        { identity: null, confidence: 0.2, abstain: true, candidates: [a1, b2], ranked: sc(['a-1', 0.9], ['b-2', 0.8]), crop, box: [0, 0, 1, 1] },
        { identity: null, confidence: 0.2, abstain: true, candidates: [a1, a2], ranked: sc(['a-1', 0.9], ['a-2', 0.7]), crop, box: [0, 0, 1, 1] },
      ],
      priced: { 'a-1': { identity: a1, market_price: 3, price_variant: 'normal', price_grid: grid(3) } },
    };
  };

  test('review all: a pre-ticked pair confirms for the session but saves no correction; a Check pair ticked by hand is saved', async () => {
    const page = await popupWithChoose(bulkSaveScan);
    await page.locator('.choose-review').click();
    await expect(page.locator('#bulk-panel .bulk-keep:checked')).toHaveCount(1);
    await page.locator('#bulk-confirm').click();
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$3.00');
    await expect(page.locator('.choose-row')).toHaveCount(1);
    expect(await page.evaluate(() => window.__sent)).toEqual([]);
    await page.close();

    const again = await popupWithChoose(bulkSaveScan);
    await again.locator('.choose-review').click();
    await again.locator('#bulk-panel .bulk-keep[data-idx="1"]').check();
    await again.locator('#bulk-confirm').click();
    await expect(again.locator('.card-row[data-idx="1"] .card-price')).toHaveText('$3.00');
    // Card 0 was the scanner's own preselection (not saved); card 1 was a Check pair the user ticked themselves.
    const sent = await again.evaluate(() => window.__sent.map((m) => [m.action, m.index]));
    expect(sent).toEqual([['saveCorrection', 1]]);
    await again.close();
  });

  // ─── Price follows the chosen card: it never decides confirmation ───

  // 0: small photo, cheap best match ($3)   1: small photo, dear best match ($120)
  // 2: picture-confirmed, not high, $80     3: high tier, title-confirmed, $80
  // 4: user-confirmed earlier, $80          5: small photo, price unknown
  const stakesScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const cheap = row('c-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
    const cheap2 = row('c-2', 'Rattata', 'Base Set', 'base1', '61', arts[1]);
    const dear = row('x-1', 'Charizard', 'Base Set', 'base1', '4', arts[2]);
    const dear2 = row('x-2', 'Charmeleon', 'Base Set', 'base1', '24', arts[3]);
    const held = row('h-1', 'Blastoise', 'Base Set', 'base1', '2', arts[4]);
    const held2 = row('h-2', 'Wartortle', 'Base Set', 'base1', '42', arts[0]);
    const unk = row('u-1', 'Zubat', 'Fossil', 'base3', '57', arts[1]);
    const cards = [
      { identity: null, confidence: 0.49, abstain: true, unsure: true, smallRow: true, smallRowCos: 0.7, readHeight: 150, candidates: [cheap, cheap2], crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.49, abstain: true, unsure: true, smallRow: true, smallRowCos: 0.7, readHeight: 150, candidates: [dear, dear2], crop, box: [0, 0, 1, 1] },
      { identity: held, confidence: 0.7, abstain: false, market_price: 80, price_grid: grid(80), candidates: [held2, held], crop, box: [0, 0, 1, 1] },
      { identity: { id: 'x-9', name: 'Venusaur', set: 'Base', setCode: 'base1', number: '15' }, confidence: 0.9, abstain: false, market_price: 80, price_grid: grid(80), titleConfirmed: true, box: [0, 0, 1, 1] },
      { identity: { id: 'x-8', name: 'Mewtwo', set: 'Base', setCode: 'base1', number: '10' }, confidence: 0.7, abstain: false, market_price: 80, price_grid: grid(80), userConfirmed: true, candidates: [held, held2], crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.49, abstain: true, unsure: true, smallRow: true, smallRowCos: 0.7, readHeight: 150, candidates: [unk, cheap2], crop, box: [0, 0, 1, 1] },
    ];
    const priced = {
      'c-1': { identity: cheap, market_price: 3, price_variant: 'normal', price_grid: grid(3) },
      'c-2': { identity: cheap2, market_price: 2, price_variant: 'normal', price_grid: grid(2) },
      'x-1': { identity: dear, market_price: 120, price_variant: 'normal', price_grid: grid(120) },
      'h-1': { identity: held, market_price: 80, price_variant: 'normal', price_grid: grid(80) },
    };
    return { cards, priced };
  };

  test('a cheap small-photo card is NOT confirmed by its price: it stays a choice and shows the best match price marked unconfirmed', async () => {
    const page = await popupWithChoose(stakesScan);
    const row = page.locator('.choose-row[data-idx="0"]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.card-price')).toHaveText('$3.00 · unconfirmed');
    await expect(page.locator('.card-row[data-idx="0"] [data-open-search]')).toHaveText('None of these? Search');
    await expect.poll(() => page.evaluate(() => window.__overlay.at(-1).cards[0].display)).toMatchObject({ state: 'choose', guess: { name: 'Pidgey', price: 3 } });
    expect(await page.evaluate(() => window.__sent)).toEqual([]);
    await page.close();
  });

  test('a dear small-photo card stays a choice with its price and the high-value chip; an unknown price says no price', async () => {
    const page = await popupWithChoose(stakesScan);
    const row = page.locator('.choose-row[data-idx="1"]');
    await expect(row.locator('.card-price')).toHaveText('$120.00 · unconfirmed');
    await expect(row.locator('.value-chip')).toHaveText('High value · check the match');
    await expect(page.locator('.choose-row[data-idx="0"] .value-chip')).toHaveCount(0);
    await expect(page.locator('.choose-row[data-idx="5"] .card-price')).toHaveText('no price');
    await expect.poll(() => page.evaluate(() => window.__overlay.at(-1).cards[1].display)).toMatchObject({ state: 'choose', highValue: true });
    // Only the best match of each Choose card is priced: no rival calls.
    const calls = await page.evaluate(() => window.__priceCalls);
    expect([...calls].sort()).toEqual(['c-1', 'u-1', 'x-1']);
    await page.close();
  });

  test('picking another candidate shows that card price at once; the best match price is gone', async () => {
    const page = await popupWithChoose(stakesScan);
    const row = page.locator('.choose-row[data-idx="0"]');
    await expect(row.locator('.card-price')).toHaveText('$3.00 · unconfirmed');
    await row.locator('.pick-choice[data-pick="c-2"]').click();
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$2.00');
    await expect(page.locator('.choose-row[data-idx="0"]')).toHaveCount(0);
    await page.close();
  });

  test('a picture-confirmed card stays confirmed at any price, with the chip and no state change', async () => {
    const page = await popupWithChoose(stakesScan);
    await expect(page.locator('.choose-row[data-idx="0"]')).toHaveCount(1);
    for (const idx of [2, 3]) {
      const row = page.locator(`.card-row[data-idx="${idx}"]`);
      await expect(row.locator('.card-price')).toHaveText('$80.00');
      await expect(row.locator('.value-chip')).toHaveText('High value · check the match');
      await expect(page.locator(`.choose-row[data-idx="${idx}"]`)).toHaveCount(0);
    }
    const mine = page.locator('.card-row[data-idx="4"]');
    await expect(mine.locator('.card-price')).toHaveText('$80.00');
    await expect(mine.locator('.value-chip')).toHaveCount(0);
    const states = await page.evaluate(() => window.__overlay.at(-1).cards.map((c) => c.display?.state));
    expect(states).toEqual(['choose', 'choose', 'identified', 'identified', 'identified', 'choose']);
    const flags = await page.evaluate(() => window.__overlay.at(-1).cards.map((c) => c.display?.highValue === true));
    expect(flags).toEqual([false, true, true, true, false, false]);
    await page.close();
  });

  test('the lot strip keeps Confirmed value apart from the Unconfirmed line; export is confirmed cards only', async () => {
    const page = await popupWithChoose(stakesScan);
    const totals = page.locator('#lot-totals');
    await expect(totals.locator('.lt-unconfirmed')).toHaveText('Unconfirmed · ~$123.00 · 2 cards');
    await expect(totals.locator('.lt-item').first()).toContainText('Confirmed value $240.00 · 3 cards');
    await expect(totals.locator('.lt-guess b')).toHaveText('3');
    await expect(totals.locator('[data-lot-copy]')).toHaveText('Copy list (3)');
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (3)');
    await expect(page.locator('#msg-bar')).toHaveText('Found 6 cards · 3 need you.');
    fs.mkdirSync(path.resolve(__dirname, '../../.tmp/price-pick'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../../.tmp/price-pick/lot-strip.png') });
    await page.locator('.choose-row[data-idx="0"]').screenshot({ path: path.resolve(__dirname, '../../.tmp/price-pick/choose-row.png') });
    await page.locator('.choose-row[data-idx="1"]').screenshot({ path: path.resolve(__dirname, '../../.tmp/price-pick/high-value-chip.png') });
    await page.close();
  });

  test('skipping a card takes it out of the Unconfirmed line; confirming one moves its price into Confirmed value', async () => {
    const page = await popupWithChoose(stakesScan);
    const totals = page.locator('#lot-totals');
    await expect(totals.locator('.lt-unconfirmed')).toHaveText(/· 2 cards/);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(totals.locator('.lt-unconfirmed')).toHaveText('Unconfirmed · ~$3.00 · 1 card');
    await expect(page.locator('.skipped-row .card-price')).toHaveCount(0);
    await page.locator('.choose-row[data-idx="0"] [data-confirm-best]').click();
    await expect(totals.locator('.lt-item').first()).toContainText('Confirmed value $243.00 · 4 cards');
    await expect(totals.locator('.lt-unconfirmed')).toHaveCount(0);
    await page.close();
  });

  test('an old best-match price is tagged and left out of the Unconfirmed line', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
      const a = row('s-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
      const grid = { source: 'pokemontcg', updatedAt: '2020-01-01T00:00:00Z', variants: { normal: { market: 4, conditions: { NM: 4 } } } };
      return {
        cards: [{ identity: null, confidence: 0.3, abstain: true, candidates: [a], crop, box: [0, 0, 1, 1] }],
        priced: { 's-1': { identity: a, market_price: 4, price_variant: 'normal', price_grid: grid } },
      };
    });
    await expect(page.locator('.choose-row[data-idx="0"] .card-price')).toHaveText('$4.00 · old price');
    await expect(page.locator('#lot-totals .lt-unconfirmed')).toHaveCount(0);
    await page.close();
  });

  test('a confirmed card whose printings range $0.21 to $103 but typically cost a few dollars is not asked about', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const cond = (nm) => ({ market: nm, conditions: { NM: nm } });
      const potion = { id: 'p-1', name: 'Potion', set: 'Base Set', setCode: 'base1', number: '94', imageUrl: arts[0] };
      const grid = { source: 'pokemontcg', variants: { normal: cond(0.21), reverseHolofoil: cond(0.5), unlimitedHolofoil: cond(10), '1stEditionHolofoil': cond(103.66) } };
      return { cards: [{ identity: potion, confidence: 0.7, abstain: false, market_price: 0.21, price_grid: grid, candidates: [potion], crop, box: [0, 0, 1, 1] }], priced: {} };
    });
    await expect(page.locator('.card-row[data-idx="0"] .card-name')).toContainText('Potion');
    await expect(page.locator('.choose-row')).toHaveCount(0);
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$0.21–$103.66');
    await page.close();
  });

  test('review all can be driven from the keyboard: Space toggles a pair, Tab stays inside the panel', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-review').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#bulk-panel .bulk-keep').first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('#bulk-confirm')).toHaveText('Confirm 1');
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.getElementById('bulk-panel').contains(document.activeElement));
    expect(inside).toBe(true);
    await page.close();
  });

  // ─── Image pickers: printings and versions are thumbnails, finishes are chips with prices ───

  const PICKER_SHOTS = path.resolve(__dirname, '../../.tmp/image-pickers');

  const printingScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, set, setCode, number, art) => ({ id, name: 'Eevee', set, setCode, number, imageUrl: art });
    const sets = [
      row('sv01-5', 'Scarlet & Violet', 'sv01', '005', arts[0]),
      row('sv02-5', 'Paldea Evolved', 'sv02', '005', arts[1]),
      row('pre-74', 'Prismatic Evolutions', 'pre', '74', arts[2]),
    ];
    const cards = [{
      identity: { id: 'sv02-5', name: 'Eevee', set: 'Paldea Evolved', setCode: 'sv02', number: '005' },
      setChoices: sets, setConfirmed: false, setRange: { low: 2, high: 9, count: 3, total: 3 },
      confidence: 0.9, abstain: false, box: [0, 0, 1, 1],
    }];
    return { cards, priced: { 'pre-74': { identity: sets[2], market_price: 9, price_variant: 'normal', price_grid: grid(9) } } };
  };

  test('printings are a strip of card thumbnails with set name and number, in a labelled radiogroup', async () => {
    const page = await popupWithChoose(printingScan);
    const group = page.getByRole('radiogroup', { name: 'Choose the version' });
    await expect(group).toBeVisible();
    const tiles = group.getByRole('radio');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first().locator('img')).toHaveAttribute('src', /^data:image\/png/);
    await expect(tiles.nth(2)).toContainText('Prismatic Evolutions');
    await expect(tiles.nth(2)).toContainText('#74');
    await expect(group.getByRole('radio', { name: 'Prismatic Evolutions number 74' })).toHaveCount(1);
    await expect(page.locator('.set-select-row select, .set-select-row option')).toHaveCount(0);
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00–$9.00');
    fs.mkdirSync(PICKER_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(PICKER_SHOTS, 'printing-strip.png') });
    await page.close();
  });

  test('tapping a printing tile saves the same correction as the old menu and prices that printing', async () => {
    const page = await popupWithChoose(printingScan);
    await page.getByRole('radio', { name: 'Prismatic Evolutions number 74' }).click();
    await expect(page.locator('.card-row .card-price')).toHaveText('$9.00');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', scanId: 'c', index: 0, pickedId: 'pre-74', via: 'set-menu' });
    expect(await page.evaluate(() => window.__priceCalls)).toEqual(['pre-74']);
    // The pick settles the row, so it collapses; focus stays in the row, on its toggle.
    expect(await page.evaluate(() => document.activeElement?.closest('.card-row')?.dataset.idx ?? null)).toBe('0');
    await expandRow(page);
    await expect(page.locator('.set-select-row [aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'pre-74');
    await page.screenshot({ path: path.join(PICKER_SHOTS, 'row-after-pick.png') });
    await page.close();
  });

  test('keyboard: arrows move through the printing strip, Enter selects, focus stays in the row', async () => {
    const page = await popupWithChoose(printingScan);
    const tiles = page.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio');
    await tiles.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tiles.nth(1)).toBeFocused();
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-row .card-price')).toHaveText('$9.00');
    expect((await page.evaluate(() => window.__sent))[0]).toMatchObject({ pickedId: 'pre-74', via: 'set-menu' });
    expect(await page.evaluate(() => document.activeElement?.closest('.card-row')?.dataset.idx ?? null)).toBe('0');
    await page.close();
  });

  test('more than 8 printings: the first 8 and a More tile that expands in place', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const sets = Array.from({ length: 11 }, (_, i) => ({ id: `s-${i}`, name: 'Pikachu', set: `Set ${i + 1}`, setCode: `s${i}`, number: String(i + 1), imageUrl: arts[i % 5] }));
      return { cards: [{ identity: sets[0], setChoices: sets, setConfirmed: false, setRange: { low: 1, high: 4, count: 11, total: 11 }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1] }], priced: {} };
    });
    const group = page.getByRole('radiogroup', { name: 'Choose the version' });
    await expect(group.getByRole('radio')).toHaveCount(8);
    await group.getByRole('button', { name: 'More +3' }).click();
    await expect(group.getByRole('radio')).toHaveCount(11);
    await expect(group.getByRole('button', { name: 'Fewer' })).toBeFocused();
    await group.getByRole('button', { name: 'Fewer' }).click();
    await expect(group.getByRole('radio')).toHaveCount(8);
    await page.close();
  });

  test('art that fails to load becomes a text tile with the name and set, and the choice still works', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const grid = { source: 'pokemontcg', variants: { normal: { market: 7, conditions: { NM: 7 } } } };
      const sets = [
        { id: 'a-1', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51', imageUrl: 'data:image/png;base64,AAAA' },
        { id: 'b-1', name: 'Eevee', set: 'Fossil', setCode: 'base3', number: '51', imageUrl: arts[0] },
      ];
      return { cards: [{ identity: sets[0], setChoices: sets, setConfirmed: false, setRange: { low: 1, high: 7, count: 2, total: 2 }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1] }],
        priced: { 'a-1': { identity: sets[0], market_price: 7, price_variant: 'normal', price_grid: grid } } };
    });
    const broken = page.getByRole('radio', { name: 'Jungle number 51' });
    await expect(broken.locator('.strip-art')).toHaveClass(/no-art/);
    await expect(broken.locator('img')).toHaveCount(0);
    await expect(broken.locator('.strip-fallback')).toBeVisible();
    await expect(broken.locator('.strip-fallback')).toContainText('Eevee');
    await expect(broken.locator('.strip-fallback')).toContainText('Jungle');
    await broken.click();
    await expect(page.locator('.card-row .card-price')).toHaveText('$7.00');
    await page.close();
  });

  const versionScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const ex = { id: 'p-1', name: 'Pikachu ex', set: 'Surging Sparks', setCode: 'sv08', number: '57', imageUrl: arts[0] };
    const v = { id: 'p-2', name: 'Pikachu V', set: 'Vivid Voltage', setCode: 'swsh4', number: '43', imageUrl: arts[1], market_price: 2, price_variant: 'normal', price_grid: grid(2), setChoices: [] };
    return { cards: [{ identity: ex, confidence: 0.9, abstain: false, market_price: 30, price_grid: grid(30), versionChoices: [v], box: [0, 0, 1, 1] }], priced: {} };
  };

  test('other versions are a thumbnail strip with the version name; one tap swaps the row to it', async () => {
    const page = await popupWithChoose(versionScan);
    await expandRow(page);
    const group = page.getByRole('radiogroup', { name: 'Choose the version' });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('radio').nth(1)).toContainText('Pikachu V');
    await expect(group.getByRole('radio').nth(1).locator('img')).toHaveAttribute('src', /^data:image\/png/);
    await expect(page.locator('.version-select-row select')).toHaveCount(0);
    await group.getByRole('radio').nth(1).click();
    await expect(page.locator('.card-row .card-name')).toContainText('Pikachu V');
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00');
    await expect(page.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');
    await page.close();
  });

  test('tapping a definite version saves a correction with that version as the pick', async () => {
    const page = await popupWithChoose(versionScan);
    await expandRow(page);
    await page.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio').nth(1).click();
    await expect(page.locator('.card-row .card-name')).toContainText('Pikachu V');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', scanId: 'c', index: 0, pickedId: 'p-2', via: 'candidates' });
    await page.close();
  });

  test('tapping a version printed in several sets saves nothing until a set is picked', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const ex = { id: 'p-1', name: 'Pikachu ex', set: 'Surging Sparks', setCode: 'sv08', number: '57', imageUrl: arts[0] };
      const sets = [
        { id: 'p-2', name: 'Pikachu V', set: 'Vivid Voltage', setCode: 'swsh4', number: '43', imageUrl: arts[1] },
        { id: 'p-3', name: 'Pikachu V', set: 'Promo', setCode: 'swshp', number: '44', imageUrl: arts[2] },
      ];
      const v = { id: 'p-2', name: 'Pikachu V', set: 'Vivid Voltage', setCode: 'swsh4', number: '43', imageUrl: arts[1], setChoices: sets, setRange: { low: 1, high: 2, count: 2, total: 2 } };
      return { cards: [{ identity: ex, confidence: 0.9, abstain: false, versionChoices: [v], box: [0, 0, 1, 1] }], priced: {} };
    });
    await expandRow(page);
    await page.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio').nth(1).click();
    await expect(page.locator('.card-row .card-name')).toContainText('Pikachu V');
    expect(await page.evaluate(() => window.__sent)).toEqual([]);
    await page.close();
  });

  test('a rescanResult sent from a tab context is ignored by the scanner window', async () => {
    const page = await popupWithChoose(versionScan);
    await expect(page.locator('.card-row .card-name')).toContainText('Pikachu ex');
    await pageSays({
      action: 'rescanResult',
      data: { cards: [{ identity: { id: 'z-9', name: 'Zubat', set: 'Jungle', setCode: 'base2', number: '9' }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1] }], scanId: 'z', srcWidth: 10, srcHeight: 10, pending: 0 },
    });
    await page.waitForTimeout(500);
    await expect(page.locator('.card-row .card-name')).toContainText('Pikachu ex');
    await expect(page.locator('.card-row .card-name')).not.toContainText('Zubat');
    await page.close();
  });

  const finishScan = () => ({
    cards: [{
      identity: { id: 'x-1', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51' }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1],
      price_grid: { source: 'pokemontcg', variants: {
        normal: { market: 2, conditions: { NM: 2, LP: 1.5 } },
        holofoil: { market: 10, conditions: { NM: 10, LP: 8 } },
        reverseHolofoil: { market: 4, conditions: { NM: 4 } },
        '1stEditionHolofoil': { market: 0, conditions: {} },
      } },
    }],
    priced: {},
  });

  test('finishes are large chips with the finish and its price; one tap sets the printing and the price', async () => {
    const page = await popupWithChoose(finishScan);
    const group = page.getByRole('radiogroup', { name: /^Choose the version/ });
    const chips = group.getByRole('radio');
    await expect(chips).toHaveCount(4);
    await expect(chips.nth(0)).toContainText('Normal');
    await expect(chips.nth(0)).toContainText('$2.00');
    await expect(chips.nth(1)).toContainText('$10.00');
    await expect(chips.nth(2)).toContainText('Reverse Holo');
    await expect(chips.nth(2)).toContainText('$4.00');
    await expect(chips.nth(3)).toHaveText('1st Ed Holofoil');
    expect((await chips.nth(0).boundingBox()).height).toBeGreaterThanOrEqual(40);
    await expect(page.locator('.variant-select-row select')).toHaveCount(0);
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00–$10.00');
    fs.mkdirSync(PICKER_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(PICKER_SHOTS, 'finish-chips.png') });
    await chips.nth(2).click();
    await expect(page.locator('.card-row .card-price')).toHaveText('$4.00');
    await expect(page.locator('#s-value')).toHaveText('$4.00');
    // The pick settles the row, so it collapses; focus goes to its toggle. Open it again to check the chip.
    await expect(page.locator('.card-row .row-toggle')).toBeFocused();
    await expandRow(page);
    await expect(group.getByRole('radio', { name: 'Reverse Holo, $4.00 NM' })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('radio', { name: 'Reverse Holo, $4.00 NM' }).focus();
    // Arrow keys move, Enter picks.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-row .card-price')).toHaveText('$10.00');
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    await page.screenshot({ path: path.join(PICKER_SHOTS, 'finish-chosen.png') });
    await page.close();
  });

  // ─── Tapping the image of a suggestion confirms it, like the ? button ───

  const guessedScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const sets = [
      { id: 'sv01-5', name: 'Eevee', set: 'Scarlet & Violet', setCode: 'sv01', number: '005', imageUrl: arts[0] },
      { id: 'sv02-5', name: 'Eevee', set: 'Paldea Evolved', setCode: 'sv02', number: '005', imageUrl: arts[1] },
    ];
    return { cards: [{
      identity: sets[1], setChoices: sets, setConfirmed: false, setRange: { low: 2, high: 9, count: 2, total: 2 },
      bestGuess: { source: 'page', reason: 'likely Paldea Evolved' }, confidence: 0.7, abstain: false, market_price: 3, box: [0, 0, 1, 1],
      price_grid: grid(3),
    }], priced: { 'sv01-5': { identity: sets[0], market_price: 2, price_variant: 'normal', price_grid: grid(2) } } };
  };

  test('tapping the suggested printing tile confirms it exactly like the ? button', async () => {
    const page = await popupWithChoose(guessedScan);
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00–$9.00');
    const tile = page.getByRole('radio', { name: 'Suggested: Paldea Evolved number 005' });
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    await tile.click();
    await expect(page.locator('.card-row .guess-mark')).toHaveCount(0);
    await expect(page.locator('.card-row .card-price')).toHaveText('$3.00');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', scanId: 'c', index: 0, pickedId: 'sv02-5', via: 'guess-confirmed' });
    expect(await page.evaluate(() => window.__priceCalls)).toEqual([]);
    // Confirming settles the row, so it collapses; open it again.
    await expandRow(page);
    await expect(page.locator('.strip-suggested')).toHaveCount(0);
    // Already confirmed: another tap does nothing and sends nothing.
    await page.getByRole('radio', { name: 'Paldea Evolved number 005' }).click();
    expect(await page.evaluate(() => window.__sent.length)).toBe(1);
    await expect(page.locator('.card-row .card-price')).toHaveText('$3.00');
    await page.close();
  });

  test('tapping a different printing tile than the suggested one picks that one', async () => {
    const page = await popupWithChoose(guessedScan);
    await page.getByRole('radio', { name: 'Scarlet & Violet number 005' }).click();
    await expect(page.locator('.card-row .card-price')).toHaveText('$2.00');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ pickedId: 'sv01-5', via: 'set-menu' });
    await page.close();
  });

  test('tapping the suggested finish chip confirms it like the ? button; a confirmed chip does nothing', async () => {
    const page = await popupWithChoose(() => ({
      cards: [{
        identity: { id: 'x-1', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51' }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1],
        variant: { edition: 'standard', finish: 'reverse', stamp: 'none' },
        price_grid: { source: 'pokemontcg', variants: {
          normal: { market: 2, conditions: { NM: 2 } }, holofoil: { market: 10, conditions: { NM: 10 } }, reverseHolofoil: { market: 4, conditions: { NM: 4 } },
        } },
      }],
      priced: {},
    }));
    const chip = page.locator('.chip-suggested');
    await expect(chip).toHaveAttribute('data-strip-pick', 'reverseHolofoil');
    await chip.click();
    await expect(page.locator('button[data-variant-confirm]')).toHaveCount(0);
    await expect(page.locator('.card-row .card-price')).toHaveText('$4.00');
    await expandRow(page); // the pick settled the row, so it collapsed
    await expect(page.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'reverseHolofoil');
    await page.locator('.chip[aria-checked="true"]').click();
    await expect(page.locator('.card-row .card-price')).toHaveText('$4.00');
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    await page.close();
  });

  // ─── Round 3: catalog art for every choice, a version tap stays confirmed, focus stays in the strip ───

  // A card-shaped picture (name and number drawn on it) served for the catalog host, so screenshots show real art.
  async function artPng(label, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="252" height="352"><rect width="252" height="352" rx="14" fill="${color}"/><rect x="16" y="16" width="220" height="40" rx="6" fill="#fff" fill-opacity="0.85"/><text x="26" y="44" font-size="22" font-family="Arial" font-weight="700" fill="#222">${label}</text><rect x="16" y="70" width="220" height="150" rx="8" fill="#fff" fill-opacity="0.35"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  test('a printing strip for Scarlet & Violet sets loads each choice own catalog art and never asks pokemontcg.io', async () => {
    const hosts = [];
    const onRequest = (request) => hosts.push(request.url());
    context.on('request', onRequest);
    const pokemontcg = async (route) => route.fulfill({ status: 404, contentType: 'image/png', body: await artPng('CARD BACK', '#223') });
    await context.route('https://images.pokemontcg.io/**', pokemontcg);
    const bodies = { 'sv01-5': await artPng('Eevee 005', '#c0504d'), 'sv03-166': await artPng('Eevee 166', '#4f81bd'), 'sv04-9': await artPng('Eevee 009', '#9bbb59') };
    const tcgdex = async (route) => {
      const url = route.request().url();
      const key = Object.keys(bodies).find((k) => url.includes(`/${k.split('-')[0]}/`)) || 'sv01-5';
      await route.fulfill({ status: 200, contentType: 'image/png', body: bodies[key] });
    };
    await context.route('https://assets.tcgdex.net/**', tcgdex);
    try {
      const page = await popupWithChoose(() => {
        const row = (id, set, setCode, number, imageUrl) => ({ id, name: 'Eevee', set, setCode, number, ...(imageUrl ? { imageUrl } : {}) });
        const sets = [
          row('sv01-5', 'Scarlet & Violet', 'sv01', '005', 'https://assets.tcgdex.net/en/sv/sv01/005/high.webp'),
          row('sv03-166', 'Obsidian Flames', 'sv03', '166', 'https://assets.tcgdex.net/en/sv/sv03/166/high.webp'),
          row('sv04-9', 'Paradox Rift', 'sv04', '009'),
        ];
        return { cards: [{ identity: sets[1], setChoices: sets, setConfirmed: false, bestGuess: { source: 'page', reason: 'likely Obsidian Flames' }, setRange: { low: 1, high: 6, count: 3, total: 3 }, confidence: 0.7, abstain: false, market_price: 3, box: [0, 0, 1, 1] }], priced: {} };
      });
      const tiles = page.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio');
      await expect(tiles).toHaveCount(3);
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.strip-art img')].every((i) => i.complete && i.naturalWidth > 100))).toBe(true);
      await expect(page.locator('.strip-art.no-art')).toHaveCount(0);
      expect(hosts.filter((u) => u.includes('images.pokemontcg.io'))).toEqual([]);
      expect(hosts.some((u) => u === 'https://assets.tcgdex.net/en/sv/sv03/166/high.webp')).toBe(true);
      // The row with no imageUrl asks the catalog host for its own picture, not pokemontcg.io.
      expect(hosts.some((u) => u === 'https://assets.tcgdex.net/en/sv/sv04/009/high.webp')).toBe(true);
      fs.mkdirSync(PICKER_SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(PICKER_SHOTS, 'printing-strip-sv-art.png') });
      await page.close();
    } finally {
      context.off('request', onRequest);
      await context.unroute('https://images.pokemontcg.io/**', pokemontcg);
      await context.unroute('https://assets.tcgdex.net/**', tcgdex);
    }
  });

  test('a picture that decodes to a speck is a failure: the tile becomes a text tile', async () => {
    const page = await popupWithChoose(() => {
      const speck = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const sets = [
        { id: 'a-1', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51', imageUrl: speck },
        { id: 'b-1', name: 'Eevee', set: 'Fossil', setCode: 'base3', number: '51', imageUrl: speck },
      ];
      return { cards: [{ identity: sets[0], setChoices: sets, setConfirmed: false, setRange: { low: 1, high: 7, count: 2, total: 2 }, confidence: 0.9, abstain: false, box: [0, 0, 1, 1] }], priced: {} };
    });
    await expect(page.locator('.strip-art.no-art')).toHaveCount(2);
    await expect(page.getByRole('radio', { name: 'Jungle number 51' }).locator('.strip-fallback')).toBeVisible();
    await page.close();
  });

  const confirmedThenVersion = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const pidgey = { id: 'a-1', name: 'Pidgey', set: 'Jungle', setCode: 'base2', number: '57', imageUrl: arts[0] };
    const pidgeotto = { id: 'a-2', name: 'Pidgeotto', set: 'Jungle', setCode: 'base2', number: '22', imageUrl: arts[1], market_price: 6, price_variant: 'normal', price_grid: grid(6), setChoices: [] };
    return {
      cards: [{ identity: null, confidence: 0.3, abstain: true, unsure: true, candidates: [pidgey], versionChoices: [pidgeotto], crop, box: [0, 0, 1, 1] }],
      priced: { 'a-1': { identity: pidgey, market_price: 3, price_variant: 'normal', price_grid: grid(3) } },
    };
  };

  test('after confirming from Choose, tapping another version keeps the row confirmed with the new name and price', async () => {
    const page = await popupWithChoose(confirmedThenVersion);
    await page.locator('.choose-row [data-confirm-best]').click();
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$3.00');
    await expect(page.locator('.choose-row')).toHaveCount(0);
    await expandRow(page); // the confirm collapsed the row
    await page.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio', { name: /Pidgeotto/ }).click();
    await expect(page.locator('.card-row[data-idx="0"] .card-name')).toContainText('Pidgeotto');
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$6.00');
    await expect(page.locator('.choose-row')).toHaveCount(0);
    await expect(page.locator('#msg-bar')).not.toContainText('need you');
    await expect(page.locator('.lt-guess b')).toHaveText('0');
    await expect(page.locator('#msg-bar')).not.toContainText('Price updated for Pidgey');
    await page.screenshot({ path: path.join(PICKER_SHOTS, 'version-swap.png') });
    await page.close();
  });

  test('finishing the model download clears the progress text', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(() => {
      const listeners = [];
      const onMessage = chrome.runtime.onMessage;
      const add = onMessage.addListener.bind(onMessage);
      onMessage.addListener = (fn) => { listeners.push(fn); add(fn); };
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action !== 'startSetup') return real(msg);
        for (const fn of listeners) fn({ action: 'setupProgress', file: 'meta.json', fileIndex: 4, fileDone: true, totalFiles: 5, bytesLoaded: 1, bytesTotal: 1 });
        if (!document.getElementById('setup-status').textContent.includes('Downloading 5 of 5')) throw new Error('progress text never shown');
        return { ok: true };
      };
      document.getElementById('btn-setup').click();
    });
    await expect.poll(() => page.evaluate(() => document.getElementById('setup-status').textContent)).toBe('');
    await page.close();
  });

  test('focus stays in the strip: on the chosen finish chip, the newly checked printing tile, and the new version tile', async () => {
    const page = await popupWithChoose(finishScan);
    const chips = page.getByRole('radiogroup', { name: /^Choose the version/ }).getByRole('radio');
    await chips.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-row .card-price')).toHaveText('$10.00');
    // The first pick settles the row, so it collapses and focus goes to its toggle. Opened again, the row stays open and focus stays in the strip.
    await expect(page.locator('.card-row .row-toggle')).toBeFocused();
    await expandRow(page);
    await chips.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-row .card-price')).toHaveText('$4.00');
    expect(await page.evaluate(() => document.activeElement?.dataset.stripPick)).toBe('reverseHolofoil');
    expect(await page.evaluate(() => document.activeElement?.dataset.stripKind)).toBe('finish');
    await page.close();

    const sets = await popupWithChoose(printingScan);
    const tiles = sets.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio');
    await tiles.first().focus();
    await sets.keyboard.press('ArrowRight');
    await sets.keyboard.press('ArrowRight');
    await sets.keyboard.press('Enter');
    await expect(sets.locator('.card-row .card-price')).toHaveText('$9.00');
    // The pick settles the row: it collapses and focus goes to its toggle; opened again, the picked tile is checked.
    await expect(sets.locator('.card-row .row-toggle')).toBeFocused();
    await expandRow(sets);
    await expect(sets.locator('.set-select-row [role="radio"][aria-checked="true"]')).toHaveAttribute('data-strip-pick', 'pre-74');
    await sets.close();

    const versions = await popupWithChoose(versionScan);
    await expandRow(versions);
    const vt = versions.getByRole('radiogroup', { name: 'Choose the version' }).getByRole('radio');
    await vt.first().focus();
    await versions.keyboard.press('ArrowRight');
    await versions.keyboard.press('Enter');
    await expect(versions.locator('.card-row .card-name')).toContainText('Pikachu V');
    await expect.poll(() => versions.evaluate(() => { const a = document.activeElement; return [a?.dataset.stripKind, a?.getAttribute('aria-checked'), a?.textContent]; })).toEqual(['version', 'true', expect.stringContaining('Pikachu V')]);
    await versions.close();
  });
  // ─── Corrections that stick: the why-record, the chips, and what memory confirms ───

  const MEM_SHOTS = path.resolve(__dirname, '../../.tmp/g12');
  // 0: confirmed by the user's earlier correction, $5     1: same, $80, below the high bar (back to Choose)
  // 2: same, $80, at the high bar (stays confirmed)       3: picture-confirmed with a why-record (the one to correct)
  // 4: a card to choose that negative memory knows
  const memoryScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const oddish = row('m-1', 'Oddish', 'Jungle', 'base2', '58', arts[0]);
    const venus = row('m-2', 'Venusaur', 'Base Set', 'base1', '15', arts[1]);
    const blast = row('m-3', 'Blastoise', 'Base Set', 'base1', '2', arts[2]);
    const other = row('m-4', 'Pidgey', 'Jungle', 'base2', '57', arts[3]);
    const found = row('f-1', 'Raichu', 'Base Set', 'base1', '14', arts[4]);
    const correctionWhy = (cos) => ({ w: 1, src: 'correction', cos, lead: 0.1, h: 240, others: ['Pidgey', 'Rattata'], ref: { id: 's0:1', cos, n: 1, ts: Date.UTC(2026, 9, 20), bar: 0.86 } });
    const memory = (cardId, cos, n = 1) => ({ level: 'confirm', cardId, cos, refId: 's0:1', n, ts: Date.UTC(2026, 9, 20) });
    const cards = [
      { identity: oddish, confidence: 0.79, abstain: false, market_price: 5, price_grid: grid(5), confirmedBy: 'correction', memory: memory('m-1', 0.9), referencedId: 'm-1', why: correctionWhy(0.9), box: [0, 0, 1, 1] },
      { identity: venus, confidence: 0.79, abstain: false, market_price: 80, price_grid: grid(80), confirmedBy: 'correction', memory: memory('m-2', 0.85), referencedId: 'm-2', why: correctionWhy(0.85), candidates: [other, venus], crop, box: [0, 0, 1, 1] },
      { identity: blast, confidence: 0.79, abstain: false, market_price: 80, price_grid: grid(80), confirmedBy: 'correction', memory: memory('m-3', 0.87), referencedId: 'm-3', why: correctionWhy(0.87), candidates: [other, blast], crop, box: [0, 0, 1, 1] },
      { identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58' }, confidence: 0.7, abstain: false, market_price: 5, price_grid: grid(5), why: { w: 1, src: 'picture', cos: 0.812, lead: 0.05, h: 212, title: 'agree', others: ['Pidgey', 'Rattata'] }, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.3, abstain: true, unsure: true, memory: { level: 'negative', cardId: 'm-1', cos: 0.85, refId: 's0:1', n: 1, wrongId: 'x-9' }, referencedId: 'm-1', candidates: [oddish, other], crop, box: [0, 0, 1, 1] },
    ];
    const priced = {
      'm-1': { identity: oddish, market_price: 5, price_variant: 'normal', price_grid: grid(5) },
      'm-2': { identity: venus, market_price: 80, price_variant: 'normal', price_grid: grid(80) },
      'f-1': { identity: found, market_price: 7, price_variant: 'normal', price_grid: grid(7) },
    };
    return { cards, priced, found: [found] };
  };

  test('a row confirmed by an earlier correction says so, and "Why this card?" explains it in plain words', async () => {
    const page = await popupWithChoose(memoryScan);
    const row = page.locator('.card-row[data-idx="0"]');
    await expect(row.locator('.card-name')).toContainText('Oddish');
    await expandRow(page, 0);
    await expect(row.locator('.memory-chip')).toHaveText('From your correction');
    await expect(row.locator('.why-pop')).toHaveCount(0);
    await row.locator('.why-btn').click();
    await expect(row.locator('.why-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#why-0')).toContainText('From your earlier correction on 2026-10-20: you said it was Oddish');
    await expect(page.locator('#why-0')).toContainText('0.90 similarity (needed 0.86)');
    await expect(page.locator('#why-0')).toContainText('Closest others: Pidgey, Rattata');
    await expect(row.locator('[data-open-search]')).toHaveText('Change');
    await expect(row.locator('[data-open-search]')).toHaveAttribute('aria-label', 'Change Oddish, pick the right card');
    fs.mkdirSync(MEM_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(MEM_SHOTS, 'why-popover.png') });
    await row.locator('.why-btn').click();
    await expect(page.locator('#why-0')).toHaveCount(0);
    await page.close();
  });

  test('a picture-confirmed row explains the match by picture', async () => {
    const page = await popupWithChoose(memoryScan);
    await expandRow(page, 3);
    await page.locator('.card-row[data-idx="3"] .why-btn').click();
    await expect(page.locator('#why-3')).toContainText('Matched by picture: 0.81 similarity, clearly ahead of the next card, 212 px tall.');
    await expect(page.locator('#why-3')).toContainText('The title line agrees.');
    await page.close();
  });

  test('final review: a new lot starts with every "Why this card?" closed', async () => {
    const page = await popupWithChoose(memoryScan);
    await expandRow(page, 3);
    await page.locator('.card-row[data-idx="3"] .why-btn').click();
    await expect(page.locator('#why-3')).toHaveCount(1);
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    // The new lot's rows start collapsed too.
    await expect(page.locator('.card-row[data-idx="3"]')).toHaveClass(/is-collapsed/);
    await expandRow(page, 3);
    await expect(page.locator('.card-row[data-idx="3"] .why-btn')).toBeVisible();
    await expect(page.locator('#why-3')).toHaveCount(0);
    await page.close();
  });

  test('final review: Clear then Undo puts an open "Why this card?" back, and a different lot gets none', async () => {
    const page = await popupWithChoose(memoryScan, { ok: true }, { tabUrl: LOT_URL });
    await expandRow(page, 3);
    await page.locator('.card-row[data-idx="3"] .why-btn').click();
    await page.locator('#btn-clear').click();
    await page.locator('#msg-bar .toast-action').click();
    await expect(page.locator('#why-3')).toHaveCount(1);
    await page.close();
  });

  test('a correction-confirmed card is confirmed at the same bar whatever its price; a $50+ one carries the chip', async () => {
    const page = await popupWithChoose(memoryScan);
    await expect(page.locator('.choose-row[data-idx="1"]')).toHaveCount(0);
    for (const idx of [1, 2]) {
      const row = page.locator(`.card-row[data-idx="${idx}"]`);
      await expect(row.locator('.card-price')).toHaveText('$80.00');
      await expect(row.locator('.memory-chip')).toHaveText('From your correction');
      await expect(row.locator('.value-chip')).toHaveText('High value · check the match');
    }
    await expect(page.locator('.card-row[data-idx="0"] .value-chip')).toHaveCount(0);
    await page.close();
  });

  test('keyboard focus stays on the same control when a best-match price arrives and the rows re-render', async () => {
    const page = await popupWithChoose(stakesScan, { ok: true }, { autoScan: false });
    await page.evaluate(() => {
      const wrapped = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action === 'priceCard') await new Promise((resolve) => setTimeout(resolve, 700));
        return wrapped(msg);
      };
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    });
    const confirm = page.locator('.choose-row[data-idx="1"] [data-confirm-best]');
    await expect(confirm).toBeVisible();
    await confirm.focus();
    await expect(page.locator('.choose-row[data-idx="1"] .card-price')).toHaveText('…');
    await expect(page.locator('.choose-row[data-idx="1"] .card-price')).toHaveText('$120.00 · unconfirmed');
    await expect(page.locator('.choose-row[data-idx="1"] [data-confirm-best]')).toBeFocused();
    await page.close();
  });

  test('negative memory: a card to choose that memory knows shows the corrected card first with the chip', async () => {
    const page = await popupWithChoose(memoryScan);
    const choose = page.locator('.choose-row[data-idx="4"]');
    await expect(choose.locator('.memory-chip')).toHaveText('You corrected this before');
    await expect(choose.locator('.pick-choice').first()).toContainText('Oddish');
    await expect(choose.locator('.pick-best')).toHaveCount(1);
    fs.mkdirSync(MEM_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(MEM_SHOTS, 'choose-corrected-before.png') });
    await page.close();
  });

  async function correctWrongCard(saveResp) {
    const page = await popupWithChoose(memoryScan, saveResp);
    const row = page.locator('.card-row[data-idx="3"]');
    await expandRow(page, 3);
    await row.locator('[data-open-search]').click();
    await row.locator('.picker-input').fill('rai');
    await row.locator('.picker-results [data-pick="f-1"]').click();
    // The pick settles the card, so its row collapses; the tests read its details.
    await expect(row).toHaveClass(/is-collapsed/);
    await expandRow(page, 3);
    return page;
  }

  test('"Wrong card?" saves the correction with the why-record of the wrong confirmation, and the row says Corrected, remembered', async () => {
    const page = await correctWrongCard({ ok: true, count: 1, remembered: true });
    const row = page.locator('.card-row[data-idx="3"]');
    await expect(row.locator('.card-name')).toContainText('Raichu');
    await expect(row.locator('.memory-chip')).toHaveText('Corrected, remembered');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', index: 3, pickedId: 'f-1', via: 'wrong-card' });
    expect(sent[0].guess.id).toBe('x-1');
    expect(sent[0].guess.why).toMatchObject({ src: 'picture', cos: 0.812, h: 212, title: 'agree', price: 5 });
    await row.locator('.why-btn').click();
    await expect(page.locator('#why-3')).toContainText('You chose this. The picture alone said Raichu at 0.81.');
    fs.mkdirSync(MEM_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(MEM_SHOTS, 'corrected-row.png') });
    await page.close();
  });

  test('a card corrected the same way twice says Corrected, remembered (x2)', async () => {
    const page = await correctWrongCard({ ok: true, count: 2, remembered: true });
    await expect(page.locator('.card-row[data-idx="3"] .memory-chip')).toHaveText('Corrected, remembered (x2)');
    await page.close();
  });

  test('with "Use my corrections" off the row says only Corrected', async () => {
    const page = await correctWrongCard({ ok: true, count: 1, remembered: false });
    await expect(page.locator('.card-row[data-idx="3"] .memory-chip')).toHaveText('Corrected');
    await page.close();
  });


  // ─── a saved lot survives the window closing (lib/lot-session.js) ───

  const LOT_URL = 'http://127.0.0.1:8765/lot-a';
  const toConfirmOf = (page) => page.locator('.choose-toggle');
  const lotRecords = (page) => page.evaluate(async () => (await chrome.storage.session.get('lotSessions')).lotSessions?.lots ?? {});
  const snapshot = (page) => page.evaluate(() => ({
    toConfirm: document.querySelector('.choose-toggle')?.textContent ?? null,
    rows: [...document.querySelectorAll('.card-row')].map((r) => `${r.dataset.idx}|${r.querySelector('.card-name')?.textContent}|${r.querySelector('.card-price')?.textContent}`),
    skipped: document.querySelector('.skipped-toggle')?.textContent ?? null,
    value: document.getElementById('s-value').textContent,
  }));
  const waitSaved = async (page, predicate) => {
    await expect.poll(async () => predicate(Object.values(await lotRecords(page))[0]?.state), { timeout: 5000 }).toBe(true);
  };

  test('closing the popup and reopening it on the same page restores the lot as it was left; Clear removes it', async () => {
    const first = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(toConfirmOf(first)).toHaveText('To confirm (4)');
    await first.locator('.choose-row').first().locator('[data-confirm-best]').click();
    await first.locator('.choose-row').first().locator('[data-confirm-best]').click();
    await first.locator('.choose-row').first().locator('[data-skip-card]').click();
    await expect(toConfirmOf(first)).toHaveText('To confirm (1)');
    const before = await snapshot(first);
    expect(before.skipped).not.toBeNull();
    await waitSaved(first, (st) => st?.cards?.filter((c) => c.skipped).length === 1 && st.cards.filter((c) => c.userConfirmed).length >= 2);
    const text = JSON.stringify(await lotRecords(first));
    expect(text.length).toBeLessThan(500_000);
    expect(Object.values(JSON.parse(text))[0].state.cards.every((c) => !c.crop || /^data:image\/jpeg/.test(c.crop))).toBe(true);
    await first.close();

    const again = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(again.locator('#restore-note')).toBeVisible();
    await expect(again.locator('#restore-text')).toContainText('Restored your last scan (just now)');
    await expect(again.locator('#restore-rescan')).toHaveText('Scan again');
    expect(await snapshot(again)).toEqual(before);
    await expect(again.locator('.choose-row [data-confirm-best]').first()).toBeFocused();
    fs.mkdirSync(path.resolve(__dirname, '../../.tmp/g5'), { recursive: true });
    await again.screenshot({ path: path.resolve(__dirname, '../../.tmp/g5/restored.png') });

    await again.locator('#btn-clear').evaluate((b) => b.click());
    await expect(again.locator('#restore-note')).toBeHidden();
    expect(Object.keys(await lotRecords(again))).toEqual([]);
    await again.close();
    const empty = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(empty.locator('#empty-hint')).toBeVisible();
    await expect(empty.locator('#restore-note')).toBeHidden();
    await empty.close();
  });

  test('a lot saved for another page, or older than 24 h, is not restored', async () => {
    const first = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(toConfirmOf(first)).toHaveText('To confirm (4)');
    await waitSaved(first, (st) => st?.cards?.length === 6);
    await first.close();

    const other = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: 'http://127.0.0.1:8765/lot-b', autoScan: false });
    await expect(other.locator('#empty-hint')).toBeVisible();
    await expect(other.locator('#restore-note')).toBeHidden();
    await other.evaluate(async () => {
      const { lotSessions } = await chrome.storage.session.get('lotSessions');
      for (const lot of Object.values(lotSessions.lots)) lot.savedAt -= 25 * 3600 * 1000;
      await chrome.storage.session.set({ lotSessions });
    });
    await other.close();
    const old = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(old.locator('#empty-hint')).toBeVisible();
    await expect(old.locator('#restore-note')).toBeHidden();
    await old.evaluate(() => chrome.storage.session.remove('lotSessions'));
    await old.close();
  });

  test('the background answers scanState and awaitScan with nothing held, and only to its own pages', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const reply = await page.evaluate(async () => ({
      state: await chrome.runtime.sendMessage({ action: 'scanState' }),
      awaited: await chrome.runtime.sendMessage({ action: 'clearPageOverlay' }).then(() => chrome.runtime.sendMessage({ action: 'awaitScan' })),
    }));
    expect(reply.state).toMatchObject({ running: false, finishedAt: null });
    expect(reply.awaited.data ?? null).toBeNull();
    await page.close();
  });

  test('Scan again on a restored lot starts a new scan', async () => {
    const first = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(toConfirmOf(first)).toHaveText('To confirm (4)');
    await first.locator('.choose-row').first().locator('[data-confirm-best]').click();
    await waitSaved(first, (st) => st?.cards?.filter((c) => c.userConfirmed).length >= 1);
    await first.close();
    const again = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(again.locator('#restore-note')).toBeVisible();
    await again.locator('#restore-rescan').click();
    await expect(again.locator('#restore-note')).toBeHidden();
    await expect(toConfirmOf(again)).toHaveText('To confirm (4)');
    await again.evaluate(() => chrome.storage.session.remove('lotSessions'));
    await again.close();
  });

  // ─── A click on a card on the page opens it in the scanner (spec 8.5) ───

  // The page's content script sends this to every extension page; a second extension page stands in for it.
  async function pageClicksCard(index) {
    const sender = await context.newPage();
    await sender.goto(`chrome-extension://${extensionId}/options.html`);
    await sender.evaluate((i) => chrome.runtime.sendMessage({ action: 'overlayPick', index: i }).catch(() => null), index);
    await sender.close();
  }
  const pendingKey = (page) => page.evaluate(async () => (await chrome.storage.session.get('pendingShow')).pendingShow ?? null);

  test('a page click on an identified card scrolls to its row, flashes it and focuses Change', async () => {
    const page = await popupWithChoose(chooseScan);
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await pageClicksCard(0);
    const row = page.locator('.card-row[data-idx="0"]');
    await expect(row).toHaveClass(/flash/);
    await expect(row.locator('.change-btn')).toBeFocused();
    await page.close();
  });

  test('a page click on a Choose card focuses its Best match tile', async () => {
    const page = await popupWithChoose(chooseScan);
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await pageClicksCard(3);
    await expect(page.locator('.choose-row[data-idx="3"] button[data-pick]').first()).toBeFocused();
    await expect(page.locator('.choose-row[data-idx="3"]')).toHaveClass(/flash/);
    await page.close();
  });

  test('a page click on a skipped card opens the Skipped group first', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(page.locator('#skipped-list')).toBeHidden();
    await pageClicksCard(1);
    await expect(page.locator('#skipped-list')).toBeVisible();
    await expect(page.locator('.skipped-row[data-idx="1"]')).toHaveClass(/flash/);
    await expect(page.locator('.skipped-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.skipped-row[data-idx="1"] [data-put-back]')).toBeFocused();
    await page.close();
  });

  test('a picture that fails to load (404) becomes a neutral placeholder with the card name, on the matched card and on candidate tiles', async () => {
    await context.route('https://art.example.test/**', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }));
    const missing = (crop) => {
      const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
      const art = 'https://art.example.test/missing.png';
      const cards = [
        { identity: { id: 'h-1', name: 'Charizard', set: 'Base', setCode: 'base1', number: '4', imageUrl: art }, confidence: 0.9, abstain: false, market_price: 120, price_grid: grid(120), crop, box: [0, 0, 1, 1] },
        { identity: null, confidence: 0.3, abstain: true, candidates: [{ id: 'a-1', name: 'Pidgey', set: 'Jungle', setCode: 'base2', number: '57', imageUrl: art }], crop, box: [0, 0, 1, 1] },
      ];
      return { cards, priced: {} };
    };
    const page = await popupWithChoose(missing);
    await expect(page.locator('.card-row[data-idx="0"] .pick-match .art-missing')).toHaveText('Charizard');
    await expect(page.locator('.card-row[data-idx="0"] .pick-match img')).toHaveCount(0);
    await expect(page.locator('.choose-row .pick-choice .art-missing')).toHaveText('Pidgey');
    await expect(page.locator('.choose-row .pick-choice img')).toHaveCount(0);
    await page.close();
    await context.unroute('https://art.example.test/**');
  });

  test('a page click on a card whose printing is still open focuses its first printing tile', async () => {
    const page = await popupWithChoose(pricedScan);
    await expect(page.locator('.pick-head')).toHaveText('Pick a version (1)');
    await pageClicksCard(1);
    await expect(page.locator('.card-row[data-idx="1"] [data-strip-pick]').first()).toBeFocused();
    await page.close();
  });

  // The pickup runs right after the restore; give it that moment, then nothing may have been scrolled to, flashed or focused.
  async function expectNoPickShown(page) {
    await page.waitForTimeout(800);
    await expect(page.locator('.card-row.flash')).toHaveCount(0);
    await expect(page.locator('[data-pick]:focus')).toHaveCount(0);
  }

  test('a pending index stored before the window loads is honored once; a stale one is ignored', async () => {
    const first = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(toConfirmOf(first)).toHaveText('To confirm (4)');
    await waitSaved(first, (st) => st?.cards?.length === 6);
    await first.evaluate(() => chrome.storage.session.set({ pendingShow: { index: 3, url: 'http://127.0.0.1:8765/lot-a#photo', at: Date.now() } }));
    await first.close();

    const fresh = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(fresh.locator('#restore-note')).toBeVisible();
    await expect(fresh.locator('.choose-row[data-idx="3"] button[data-pick]').first()).toBeFocused();
    expect(await pendingKey(fresh)).toBeNull();
    await fresh.evaluate(() => chrome.storage.session.set({ pendingShow: { index: 1, url: 'http://127.0.0.1:8765/lot-a', at: Date.now() - 60_000 } }));
    await fresh.close();

    const stale = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(stale.locator('#restore-note')).toBeVisible();
    await expect.poll(() => pendingKey(stale)).toBeNull();
    await expectNoPickShown(stale);
    // A fresh index for another page than the lot is discarded too.
    await stale.evaluate(() => chrome.storage.session.set({ pendingShow: { index: 3, url: 'http://127.0.0.1:8765/another-page', at: Date.now() } }));
    await stale.close();

    const other = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(other.locator('#restore-note')).toBeVisible();
    await expect.poll(() => pendingKey(other)).toBeNull();
    await expectNoPickShown(other);
    await other.evaluate(() => chrome.storage.session.remove('lotSessions'));
    await other.close();
  });

  // ─── High value: double-check with a Confirm check (spec 9.8) ───

  const flagScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const cards = [
      { identity: row('h-1', 'Charizard', 'Base', 'base1', '4', arts[0]), confidence: 0.9, abstain: false, market_price: 120, price_grid: grid(120), crop, box: [0, 0, 1, 1] },
      { identity: row('x-1', 'Pikachu', 'Base', 'base1', '58', arts[1]), confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), crop, box: [0, 0, 1, 1] },
    ];
    return { cards, priced: {} };
  };

  test('a high-value row shows the page picture beside the matched card, with Confirm and Change, and the lot says what is left', async () => {
    const page = await popupWithChoose(flagScan);
    const row = page.locator('.card-row[data-idx="0"]');
    await expect(row.locator('.value-chip')).toHaveText('High value · check the match');
    await expect(row.locator('.scanned-card img')).toHaveCount(1);
    await expect(row.locator('.pick-match img')).toHaveAttribute('src', /^data:image\/png/);
    await expect(row.locator('.pick-match')).toContainText('Matched');
    await expect(row.locator('.pick-match')).toContainText('Charizard');
    await expect(row.getByRole('button', { name: 'Confirm Charizard, it matches' })).toBeVisible();
    await expect(row.locator('[data-open-search]')).toHaveCount(1);
    await expect(page.locator('.card-row[data-idx="1"] .pick-match')).toHaveCount(0);
    await expect(page.locator('.lt-done')).toHaveCount(0);
    await expect(page.locator('#lot-totals .lt-check')).toHaveText('1 to double-check');
    await page.close();
  });

  test('Confirm clears the flag and the page mark, keeps the total, saves like a best-match confirm, and ends on All cards priced', async () => {
    const page = await popupWithChoose(flagScan);
    const before = await page.locator('#s-value').textContent();
    await page.locator('.card-row[data-idx="0"] [data-confirm-match]').click();
    await expect(page.locator('.value-chip')).toHaveCount(0);
    await expect(page.locator('.card-row[data-idx="0"] .pick-match')).toHaveCount(0);
    // The row collapses to a normal priced row; Change stays available once it is opened.
    await expect(page.locator('.card-row[data-idx="0"]')).toHaveClass(/is-collapsed/);
    await expandRow(page, 0);
    await expect(page.locator('.card-row[data-idx="0"] .change-btn')).toBeVisible();
    await expect(page.locator('#s-value')).toHaveText(before);
    await expect(page.locator('.lt-done')).toHaveText('All cards priced');
    await expect(page.locator('#lot-totals .lt-check')).toHaveCount(0);
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', scanId: 'c', index: 0, pickedId: 'h-1', via: 'candidates' });
    expect(sent[0].guess.id).toBe('h-1');
    expect(await page.evaluate(() => window.__overlay.at(-1).cards[0].display?.highValue ?? false)).toBe(false);
    await page.close();
  });

  test('a page click on a flagged card focuses its Confirm', async () => {
    const page = await popupWithChoose(flagScan);
    await expect(page.locator('.card-row[data-idx="0"] [data-confirm-match]')).toBeVisible();
    await pageClicksCard(0);
    await expect(page.locator('.card-row[data-idx="0"] [data-confirm-match]')).toBeFocused();
    await page.close();
  });

  test('hovering a priced row\'s picture compares the page crop with the matched card', async () => {
    const page = await popupWithChoose(flagScan);
    await page.setViewportSize({ width: 500, height: 900 });
    const loupe = page.locator('#loupe');
    await page.locator('.card-row[data-idx="1"] .row-thumb').hover();
    await expect(loupe).toBeVisible();
    await expect(loupe.locator('img')).toHaveCount(2);
    await expect(loupe.locator('figcaption').first()).toHaveText('On the page');
    await expect(loupe.locator('figcaption').last()).toContainText('Pikachu');
    await page.close();
  });

  // ─── "Can't price this": the user's way out for a card the catalog cannot name ───

  const SKIP_SHOTS = path.resolve(__dirname, '../../.tmp/skip');
  const skipNameRe = /^Skip this card: I can't price it \(not English, not a card\)$/;

  test('every Choose row has a Can\'t price this button with its own accessible name, reachable by keyboard', async () => {
    const page = await popupWithChoose(chooseScan);
    const buttons = page.locator('.choose-row [data-skip-card]');
    await expect(buttons).toHaveCount(4);
    await expect(buttons.first()).toHaveText('Skip this card');
    await expect(buttons.first()).toHaveAccessibleName(skipNameRe);
    await page.locator('.choose-row').first().locator('[data-open-search]').focus();
    await page.keyboard.press('Tab');
    await expect(buttons.first()).toBeFocused();
    fs.mkdirSync(SKIP_SHOTS, { recursive: true });
    await page.locator('.choose-row').first().screenshot({ path: path.join(SKIP_SHOTS, 'choose-row-with-skip.png') });
    await page.close();
  });

  test('skipping a Choose row: it moves to a collapsed Skipped (1) group, counts change, the tag is Skipped, focus and the live message follow', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (3)');
    await expect(page.locator('.choose-review')).toHaveText('Review these 3 together');
    await expect(page.locator('.choose-row[data-idx="1"]')).toHaveCount(0);
    const toggle = page.locator('.skipped-toggle');
    await expect(toggle).toHaveText('Left out (1)');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#skipped-list')).toBeHidden();
    // The group is the last thing in the list.
    expect(await page.evaluate(() => document.getElementById('results').lastElementChild.classList.contains('skipped-group'))).toBe(true);
    // Lot: To confirm drops to 3, Confirmed value is unchanged, Skipped 1 appears.
    await expect(page.locator('#lot-totals .lt-guess b')).toHaveText('3');
    await expect(page.locator('#lot-totals .lt-skipped')).toHaveText('Left out 1');
    await expect(page.locator('#s-value')).toHaveText('$12.50');
    // The scanner is told, with the scan and the card; the page overlay says skipped and names nothing.
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: 'saveSkip', scanId: 'c', index: 1 });
    const overlay = await page.evaluate(() => window.__overlay.at(-1).cards.map((c) => [c.display?.state, c.display?.name ?? null, c.display?.price ?? null]));
    expect(overlay[1]).toEqual(['skipped', null, null]);
    // Focus lands on the next Choose row's Confirm button, as after a confirm, and the message is announced.
    await expect(page.locator('.choose-row[data-idx="3"] [data-confirm-best]')).toBeFocused();
    await expect(page.locator('#msg-bar')).toHaveText(/^Skipped\. 3 to confirm\.Put back$/);
    await expect(page.locator('#msg-bar')).toHaveAttribute('role', 'status');
    // Open the group: the crop and Put back, never a name or a price.
    await toggle.click();
    const row = page.locator('.skipped-row[data-idx="1"]');
    await expect(row).toBeVisible();
    await expect(row.locator('.unrec-thumb img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(row.locator('.card-price, .card-name')).toHaveCount(0);
    await expect(row.locator('[data-put-back]')).toHaveText('Put back');
    await expect(row.locator('[data-put-back]')).toHaveAccessibleName('Put back card 2: return it to the cards to confirm');
    await page.screenshot({ path: path.join(SKIP_SHOTS, 'skipped-group.png') });
    await page.close();
  });

  test('Put back returns the card to Choose with its candidates, focus on its Confirm button', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await page.locator('.skipped-toggle').click();
    await page.locator('.skipped-row[data-idx="1"] [data-put-back]').click();
    await expect(page.locator('.skipped-group')).toHaveCount(0);
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (4)');
    const row = page.locator('.choose-row[data-idx="1"]');
    await expect(row.locator('.pick-choice')).toHaveCount(3);
    await expect(row.locator('[data-confirm-best]')).toHaveText('Confirm Rattata');
    await expect(row.locator('[data-confirm-best]')).toBeFocused();
    await expect(page.locator('#lot-totals .lt-skipped')).toHaveCount(0);
    await expect(page.locator('#msg-bar')).toHaveText('Put back. 4 to confirm.');
    const sent = await page.evaluate(() => window.__sent.map((m) => [m.action, m.index]));
    expect(sent).toEqual([['saveSkip', 1], ['unskip', 1]]);
    await page.close();
  });

  test('Put back on a removed confirmed card focuses its Change button, never the remove X', async () => {
    const page = await popupWithChoose(chooseScan);
    await expandRow(page, 0);
    await page.locator('.card-row[data-idx="0"] [data-remove-card]').click();
    await page.locator('.skipped-toggle').click();
    await page.locator('.skipped-row[data-idx="0"] [data-put-back]').click();
    await expect(page.locator('.skipped-row[data-idx="0"]')).toHaveCount(0);
    await expect(page.locator('.card-row[data-idx="0"]')).toBeVisible();
    await expect(page.locator('.card-row[data-idx="0"] [data-open-search]')).toBeFocused();
    await page.close();
  });

  test('skip and Put back work from the keyboard alone', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.choose-row[data-idx="3"] [data-confirm-best]')).toBeFocused();
    await page.locator('.skipped-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.skipped-toggle')).toHaveAttribute('aria-expanded', 'true');
    // The row's thumbnail is a "show on page" button now (section 10), so it takes the first Tab stop.
    await page.keyboard.press('Tab');
    await expect(page.locator('.skipped-row button.unrec-thumb')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.skipped-row [data-put-back]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.choose-row[data-idx="1"] [data-confirm-best]')).toBeFocused();
    await page.close();
  });

  test('skipping the last card to confirm moves focus to Copy and says nothing is left', async () => {
    const page = await popupWithChoose(chooseScan);
    for (const idx of [1, 3, 4, 5]) {
      await page.locator(`.choose-row[data-idx="${idx}"] [data-skip-card]`).focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.skipped-toggle')).toHaveText('Left out (4)');
    await expect(page.locator('.choose-group')).toHaveCount(0);
    await expect(page.locator('#lot-totals [data-lot-copy]')).toBeFocused();
    await expect(page.locator('#msg-bar')).toHaveText(/^Skipped\. Nothing left to confirm\.Put back$/);
    await page.close();
  });

  test('the export leaves skipped cards out and its tooltip says how many', async () => {
    const page = await popupWithChoose(chooseScan);
    const copy = page.locator('#lot-totals [data-lot-copy]');
    await expect(copy).toHaveAttribute('title', '4 more cards still need confirming and are not included');
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(copy).toHaveText('Copy list (2)');
    await expect(copy).toHaveAttribute('title', '3 more cards still need confirming and are not included. 1 skipped card is not included');
    await expect(page.locator('#lot-totals [data-lot-csv]')).toHaveAttribute('title', /1 skipped card is not included/);
    await page.evaluate(() => {
      window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
    });
    await copy.evaluate((b) => b.click());
    await expect(page.locator('#msg-bar')).toHaveText('Copied 2 cards · $12.50 · 3 unconfirmed left out');
    const lines = (await page.evaluate(() => window.__copied)).split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    await page.close();
  });

  test('Review all ignores skipped cards', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="3"] [data-skip-card]').click();
    await page.locator('.choose-review').click();
    await expect(page.locator('.bulk-pair')).toHaveCount(3);
    await page.close();
  });

  test('a card that is not in a skipped state keeps no Skipped count in the lot strip', async () => {
    const page = await popupWithChoose(chooseScan);
    await expect(page.locator('#lot-totals .lt-skipped')).toHaveCount(0);
    await expect(page.locator('.skipped-group')).toHaveCount(0);
    await page.close();
  });

  // A confident read of a crop like a skipped one: the scanner (background) hands it over as Choose, flagged skippedBefore.
  const rescanScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[1]);
    const first = { identity: null, confidence: 0.3, abstain: true, candidates: [a1, b2], crop, box: [0, 0, 1, 1] };
    const again = { identity: a1, confidence: 0.4, abstain: false, choose: true, skippedBefore: true, candidates: [a1, b2], smallRow: true, crop, box: [0, 0, 1, 1], market_price: 3, price_grid: grid(3) };
    return { cards: [first], rescan: [again], priced: { 'a-1': { identity: a1, market_price: 3, price_variant: 'normal', price_grid: grid(3) } } };
  };

  test('a rescan of a skipped crop stays Choose with the You skipped this before chip and a highlighted skip button; nothing is auto-skipped or auto-confirmed', async () => {
    const page = await popupWithChoose(rescanScan);
    await page.locator('.choose-row[data-idx="0"] [data-skip-card]').click();
    await expect(page.locator('.skipped-toggle')).toHaveText('Left out (1)');
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    const row = page.locator('.choose-row[data-idx="0"]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.memory-chip')).toHaveText('You skipped this before');
    await expect(row.locator('[data-skip-card]')).toHaveClass(/skip-btn-hot/);
    await expect(row.locator('[data-skip-card]')).toBeVisible();
    await expect(page.locator('.skipped-group')).toHaveCount(0);
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (1)');
    // Not named and not confirmed by its price: it shows only the unconfirmed best-match price.
    await expect(row.locator('.card-price')).toHaveText('$3.00 · unconfirmed');
    await expect(page.locator('#s-value')).toHaveText('—');
    expect(await page.evaluate(() => window.__priceCalls)).toEqual(['a-1']);
    await expect(row.locator('[data-confirm-best]')).toHaveText('Confirm Pidgey');
    const overlay = await page.evaluate(() => window.__overlay.at(-1).cards.map((c) => c.display?.state));
    expect(overlay).toEqual(['choose']);
    await page.screenshot({ path: path.join(SKIP_SHOTS, 'skipped-before-chip.png') });
    // The user's own confirm still works and prices it.
    await row.locator('[data-confirm-best]').click();
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$3.00');
    await page.close();
  });

  test('hovering a candidate previews it beside the crop; Escape closes; the crop shows alone', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 500, height: 760 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      const art = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="${c}"/></svg>`)}`;
      const near = [
        { id: 'a-1', name: 'Pidgey', set: 'Set A', setCode: 'a', number: '1', imageUrl: art('#c44') },
        { id: 'b-2', name: 'Rattata', set: 'Set B', setCode: 'b', number: '2', imageUrl: art('#48c') },
      ];
      const crop = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
      const cards = [{ identity: null, confidence: 0.3, abstain: true, candidates: near, crop, box: [0, 0, 1, 1] }];
      chrome.runtime.sendMessage = async (msg) => (msg?.action === 'scanPage'
        ? { cards, scanId: 'l', srcWidth: 10, srcHeight: 10, pending: 0 }
        : real(msg));
    });
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    const tiles = page.locator('.card-row.asking .pick-card');
    await expect(tiles).toHaveCount(2);
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    const loupe = page.locator('#loupe');
    const captions = loupe.locator('figcaption');

    await tiles.nth(0).hover();
    await expect(loupe).toBeVisible();
    await expect(loupe.locator('img')).toHaveCount(2);
    await expect(captions.nth(0)).toHaveText('On the page');
    await expect(captions.nth(1)).toContainText('Pidgey');

    await tiles.nth(1).hover();
    await expect(captions.nth(1)).toContainText('Rattata');
    await expect(loupe.locator('img')).toHaveCount(2);

    await page.keyboard.press('Escape');
    await expect(loupe).toBeHidden();

    await page.mouse.move(0, 400);
    await page.locator('.card-row.asking .scanned-card').hover();
    await expect(loupe).toBeVisible();
    await expect(loupe.locator('img')).toHaveCount(1);
    await expect(captions).toHaveText(['On the page']);
    await page.close();
  });

  // A scan whose best-match prices arrive 4 s late, so the re-render they cause lands while the pointer or focus rests on a tile.
  // After the first list is drawn it counts re-renders of #results and closes of the preview (visible to hidden).
  async function popupWithLatePrices() {
    const page = await popupWithChoose(chooseScan, { ok: true }, { autoScan: false });
    await page.evaluate(() => {
      const inner = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (m) => {
        if (m?.action === 'priceCard') await new Promise((r) => setTimeout(r, 4000));
        return inner(m);
      };
      const btn = document.getElementById('btn-scan'); btn.disabled = false; btn.click();
    });
    await expect(page.locator('.choose-row .scanned-card').first()).toBeVisible();
    await page.evaluate(() => {
      const el = document.getElementById('loupe');
      window.__loupeCloses = 0;
      window.__renders = 0;
      let wasOpen = false;
      new MutationObserver(() => { if (el.hidden && wasOpen) window.__loupeCloses += 1; wasOpen = !el.hidden; }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      new MutationObserver(() => { window.__renders += 1; }).observe(document.getElementById('results'), { childList: true, subtree: true });
    });
    return page;
  }

  // Waits for at least one list re-render after now, then a short settle; returns how many happened.
  async function awaitReRender(page) {
    const base = await page.evaluate(() => window.__renders);
    await page.waitForFunction((n) => window.__renders > n, base, { timeout: 10000 });
    await page.waitForTimeout(400);
    return (await page.evaluate(() => window.__renders)) - base;
  }

  test('the hover preview survives the price re-renders of a scan and follows the tile under a resting mouse', async () => {
    const page = await popupWithLatePrices();
    try {
      const loupe = page.locator('#loupe');
      await page.locator('.choose-row').first().locator('.scanned-card').hover();
      await expect(loupe).toBeVisible();
      expect(await awaitReRender(page)).toBeGreaterThan(0);
      await expect(loupe).toBeVisible();
      expect(await page.evaluate(() => window.__loupeCloses)).toBe(0);
      // No mouse move: the confirm re-renders the list and detaches the hovered tile without a pointerout.
      // The preview must then follow what is under the pointer.
      const after = await page.evaluate(async () => {
        const tiles = '.scanned-card, .row-thumb, .unrec-thumb, .pick-card, .strip-tile, .bulk-img';
        const el = document.getElementById('loupe');
        const tile = document.querySelector('.choose-row .scanned-card');
        const r = tile.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const openBefore = !el.hidden;
        el.firstElementChild.dataset.before = 'yes'; // a new tile builds new panels, so a missing mark means the preview was re-aimed
        document.querySelector('.choose-row [data-confirm-best]').click();
        await new Promise((res) => setTimeout(res, 0));
        return { openBefore, detached: !tile.isConnected, hidden: el.hidden, tileUnderPointer: !!document.elementFromPoint(x, y)?.closest(tiles), reaimed: !!el.firstElementChild && el.firstElementChild.dataset.before !== 'yes' };
      });
      // In this fixture the confirmed row's thumbnail takes the crop's place under the pointer, so the preview moves to it and stays open.
      expect(after).toEqual({ openBefore: true, detached: true, hidden: false, tileUnderPointer: true, reaimed: true });
    } finally {
      await page.close();
    }
  });

  test('a keyboard-opened preview stays open on the focused tile through the price re-renders', async () => {
    const page = await popupWithLatePrices();
    try {
      const loupe = page.locator('#loupe');
      const tile = page.locator('.choose-row').first().locator('.pick-card').first();
      await page.evaluate(() => document.querySelector('.choose-row .pick-card').focus());
      await expect(loupe).toBeVisible();
      expect(await awaitReRender(page)).toBeGreaterThan(0);
      await expect(loupe).toBeVisible();
      expect(await page.evaluate(() => window.__loupeCloses)).toBe(0);
      await expect(tile).toBeFocused();
      await expect(loupe.locator('figcaption').last()).toContainText('Rattata');
    } finally {
      await page.close();
    }
  });

  test('a saved large card size does not apply below 440 px and returns on a wide window', async () => {
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: 900, height: 700 });
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.evaluate(() => chrome.storage.local.set({ cardSize: 1.6 }));
      await page.reload();
      await page.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
      await page.evaluate(() => {
        const real = chrome.runtime.sendMessage.bind(chrome.runtime);
        const art = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="${c}"/></svg>`)}`;
        const near = [
          { id: 'a-1', name: 'Pidgey', set: 'Set A', setCode: 'a', number: '1', imageUrl: art('#c44') },
          { id: 'b-2', name: 'Rattata', set: 'Set B', setCode: 'b', number: '2', imageUrl: art('#48c') },
        ];
        const cards = [{ identity: null, confidence: 0.3, abstain: true, candidates: near, box: [0, 0, 1, 1] }];
        chrome.runtime.sendMessage = async (msg) => (msg?.action === 'scanPage'
          ? { cards, scanId: 's', srcWidth: 10, srcHeight: 10, pending: 0 }
          : real(msg));
        const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
      });
      const scale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--card-scale').trim());
      await expect.poll(scale).toBe('1.6');
      await expect(page.locator('.card-row.asking .pick-card')).toHaveCount(2);

      await page.setViewportSize({ width: 360, height: 640 });
      await expect.poll(scale).toBe('1');
      const metrics = () => page.evaluate(() => ({
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        w: document.querySelector('.card-row.asking .pick-card').getBoundingClientRect().width,
      }));
      const narrow = await metrics();
      expect(narrow.over).toBeLessThanOrEqual(1);
      await page.evaluate(() => document.documentElement.style.setProperty('--card-scale', '1'));
      expect((await metrics()).w).toBe(narrow.w);

      await page.evaluate(() => document.documentElement.style.setProperty('--card-scale', '1.6'));
      await page.setViewportSize({ width: 900, height: 700 });
      await expect.poll(scale).toBe('1.6');
    } finally {
      await page.evaluate(() => chrome.storage.local.remove('cardSize')).catch(() => {});
      await page.close();
    }
  });

  test('the settings page has "Use my saved fixes" on by default and remembers a switch-off', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const toggle = page.locator('#use-references');
    await page.locator('#advanced-settings > summary').click();
    await expect(toggle).toBeChecked();
    await expect(page.locator('label[for="use-references"]')).toContainText('Use my saved fixes');
    await toggle.uncheck();
    expect(await page.evaluate(async () => (await chrome.storage.local.get('useReferences')).useReferences)).toBe(false);
    await page.reload();
    await page.locator('#advanced-settings > summary').click();
    await expect(page.locator('#use-references')).not.toBeChecked();
    await page.evaluate(() => chrome.storage.local.remove('useReferences'));
    await page.close();
  });

  // ─── Confirmed cards collapse to one line (spec 12) ───

  // #0 settled; #1 high value, still to double-check; #2 a version suggested from the picture and not yet confirmed.
  const collapseScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const cards = [
      { identity: row('x-1', 'Pikachu', 'Base', 'base1', '58', arts[0]), confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), crop, box: [0, 0, 1, 1] },
      { identity: row('h-1', 'Charizard', 'Base', 'base1', '4', arts[1]), confidence: 0.9, abstain: false, market_price: 120, price_grid: grid(120), crop, box: [0, 0, 1, 1] },
      {
        identity: row('y-1', 'Eevee', 'Jungle', 'base2', '51', arts[2]), confidence: 0.9, abstain: false, crop, box: [0, 0, 1, 1],
        variant: { edition: 'standard', finish: 'reverse', stamp: 'none' },
        price_grid: { source: 'pokemontcg', variants: {
          normal: { market: 2, conditions: { NM: 2 } },
          holofoil: { market: 10, conditions: { NM: 10 } },
          reverseHolofoil: { market: 4, conditions: { NM: 4 } },
        } },
      },
    ];
    return { cards, priced: {} };
  };

  test('a confirmed row is one line: photo, name, set #number, price, chevron, and nothing else', async () => {
    const page = await popupWithChoose(collapseScan);
    const row = page.locator('.card-row[data-idx="0"]');
    await expect(row).toHaveClass(/is-collapsed/);
    await expect(row.locator('.row-thumb')).toHaveCount(1);
    await expect(row.locator('.card-name')).toHaveText('Pikachu');
    await expect(row.locator('.card-name')).toHaveAttribute('title', 'Pikachu');
    await expect(row.locator('.card-sub')).toHaveText('Base #58');
    await expect(row.locator('.card-price')).toHaveText('$5.00');
    await expect(row.locator('.row-chevron')).toHaveCount(1);
    await expect(row.locator('.change-btn, .why-btn, .remove-btn, .chip, .strip-row, .value-chip, .guess-mark')).toHaveCount(0);
    // Siblings, never nested: the photo button and the toggle button.
    await expect(row.locator('button button')).toHaveCount(0);
    const toggle = row.getByRole('button', { name: 'Pikachu, Base #58, $5.00. Show details' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'card-row-0');
    // One line: the row is short, and no horizontal overflow.
    expect((await row.boundingBox()).height).toBeLessThan(90);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.close();
  });

  test('a row with the same-name warning is not collapsed and shows the warning', async () => {
    const page = await popupWithChoose((crop, arts) => ({
      cards: [{
        identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58', imageUrl: arts[0] },
        confidence: 0.9, abstain: false, market_price: 5, crop, box: [0, 0, 1, 1], repeatedName: true,
        price_grid: { source: 'pokemontcg', variants: { normal: { market: 5, conditions: { NM: 5 } } } },
      }],
      priced: {},
    }));
    const row = page.locator('.card-row[data-idx="0"]');
    await expect(row).toBeVisible();
    await expect(row).not.toHaveClass(/is-collapsed/);
    await expect(row.locator('.row-toggle')).toHaveCount(0);
    await expect(row.locator('.repeat-mark')).toBeVisible();
    await expect(row.locator('.repeat-mark')).toHaveAttribute('title', 'Same name found several times in this photo. Check it.');
    await page.close();
  });

  test('a collapsed row shows the catalog picture, and the page crop when that picture 404s', async () => {
    const stock = await popupWithChoose(collapseScan);
    await expect(stock.locator('.card-row[data-idx="0"] .row-thumb img')).toHaveAttribute('src', /^data:image\/png/);
    await expect(stock.locator('.card-row[data-idx="0"] .row-thumb img')).toHaveAttribute('loading', 'lazy');
    await expect(stock.locator('.card-row[data-idx="0"] .row-thumb img')).toHaveAttribute('alt', '');
    await stock.close();

    await context.route('https://art.example.test/**', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }));
    const missing = (crop) => ({
      cards: [{
        identity: { id: 'x-1', name: 'Pikachu', set: 'Base', setCode: 'base1', number: '58', imageUrl: 'https://art.example.test/missing.png' },
        confidence: 0.9, abstain: false, market_price: 5, crop, box: [0, 0, 1, 1],
        price_grid: { source: 'pokemontcg', variants: { normal: { market: 5, conditions: { NM: 5 } } } },
      }],
      priced: {},
    });
    const page = await popupWithChoose(missing);
    await expect(page.locator('.card-row[data-idx="0"]')).toHaveClass(/is-collapsed/);
    await expect(page.locator('.card-row[data-idx="0"] .row-thumb img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await page.close();
    await context.unroute('https://art.example.test/**');
  });

  test('a click opens a collapsed row (Change shows), a second click closes it', async () => {
    const page = await popupWithChoose(collapseScan);
    const row = page.locator('.card-row[data-idx="0"]');
    await row.locator('.row-toggle').click();
    await expect(row).not.toHaveClass(/is-collapsed/);
    await expect(row.locator('.change-btn')).toBeVisible();
    await expect(row.locator('.row-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(row.locator('.row-toggle')).toBeFocused();
    await row.locator('.row-toggle').click();
    await expect(row).toHaveClass(/is-collapsed/);
    await expect(row.locator('.change-btn')).toHaveCount(0);
    await page.close();
  });

  test('keyboard: Enter on the toggle opens the row and Space closes it, focus staying on the toggle', async () => {
    const page = await popupWithChoose(collapseScan);
    const row = page.locator('.card-row[data-idx="0"]');
    await row.locator('.row-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(row.locator('.change-btn')).toBeVisible();
    await expect(row.locator('.row-toggle')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(row.locator('.change-btn')).toHaveCount(0);
    await expect(row.locator('.row-toggle')).toBeFocused();
    await page.close();
  });

  test('a high-value row awaiting Confirm is not collapsed; Confirm collapses it with focus on its toggle', async () => {
    const page = await popupWithChoose(collapseScan);
    const row = page.locator('.card-row[data-idx="1"]');
    await expect(row).not.toHaveClass(/is-collapsed/);
    await expect(row.locator('.row-toggle')).toHaveCount(0);
    await row.locator('[data-confirm-match]').click();
    await expect(row).toHaveClass(/is-collapsed/);
    await expect(row.locator('.row-toggle')).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
    await page.close();
  });

  test('a row with a suggested, unconfirmed version is not collapsed; confirming the version collapses it', async () => {
    const page = await popupWithChoose(collapseScan);
    const row = page.locator('.card-row[data-idx="2"]');
    await expect(row).not.toHaveClass(/is-collapsed/);
    await expect(row.locator('.row-toggle')).toHaveCount(0);
    await row.locator('button[data-variant-confirm]').evaluate((b) => b.click());
    await expect(row).toHaveClass(/is-collapsed/);
    await expect(row.locator('.card-price')).toHaveText('$4.00');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
    await page.close();
  });

  test('a page click on a collapsed card opens its row', async () => {
    const page = await popupWithChoose(collapseScan);
    await expect(page.locator('.card-row[data-idx="0"]')).toHaveClass(/is-collapsed/);
    await pageClicksCard(0);
    const row = page.locator('.card-row[data-idx="0"]');
    await expect(row).not.toHaveClass(/is-collapsed/);
    await expect(row.locator('.change-btn')).toBeVisible();
    await expect(row).toHaveClass(/flash/);
    await page.close();
  });

  test('a reopened lot shows its rows collapsed, even one the user had opened', async () => {
    const first = await popupWithChoose(collapseScan, { ok: true }, { tabUrl: LOT_URL });
    await first.locator('.card-row[data-idx="0"] .row-toggle').click();
    await expect(first.locator('.card-row[data-idx="0"] .change-btn')).toBeVisible();
    await waitSaved(first, (st) => st?.cards?.length === 3);
    await first.close();
    const again = await popupWithChoose(collapseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(again.locator('#restore-note')).toBeVisible();
    await expect(again.locator('.card-row[data-idx="0"]')).toHaveClass(/is-collapsed/);
    await again.evaluate(() => chrome.storage.session.remove('lotSessions'));
    await again.close();
  });

  // ─── Round 3: every row has its picture, one row structure at every width, the final pricing screen, Change ───

  const pricedScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const finishes = { source: 'pokemontcg', variants: { normal: { market: 3, conditions: { NM: 3 } }, holofoil: { market: 9, conditions: { NM: 9 } } } };
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const sets = [row('s-1', 'Eevee', 'Scarlet & Violet', 'sv01', '005', arts[0]), row('s-2', 'Eevee', 'Paldea Evolved', 'sv02', '005', arts[1])];
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[2]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[3]);
    const cards = [
      { identity: row('x-1', 'Pikachu', 'Base', 'base1', '58'), confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), crop, box: [0, 0, 1, 1] },
      { identity: sets[0], setChoices: sets, setConfirmed: false, setRange: { low: 2, high: 9, count: 2, total: 2 }, confidence: 0.9, abstain: false, crop, box: [0, 0, 1, 1] },
      { identity: row('x-2', 'Mega Zygarde ex with a very long name that keeps going on and on', 'Mega Evolution', 'me1', '123', null), confidence: 0.9, abstain: false, market_price: 3, price_grid: finishes, crop, box: [0, 0, 1, 1] },
      { identity: row('x-3', 'Leafeon', 'Base', 'base1', '9', null), confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), crop, box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.3, abstain: true, candidates: [a1, b2], crop, box: [0, 0, 1, 1] },
    ];
    const priced = {
      'a-1': { identity: a1, market_price: 3, price_variant: 'normal', price_grid: grid(3) },
      'b-2': { identity: b2, market_price: 4, price_variant: 'normal', price_grid: grid(4) },
      's-1': { identity: sets[0], market_price: 2, price_variant: 'normal', price_grid: grid(2) },
      's-2': { identity: sets[1], market_price: 9, price_variant: 'normal', price_grid: grid(9) },
    };
    return { cards, priced };
  };

  test('an auto-identified row shows its page picture, and hovering a printing tile compares it with that picture', async () => {
    const page = await popupWithChoose(pricedScan);
    await page.setViewportSize({ width: 500, height: 900 });
    await expandRow(page, 0); // an open row keeps the page picture in its head; a collapsed one shows the catalog picture
    await expect(page.locator('.card-row[data-idx="0"] .row-thumb img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(page.locator('.card-row[data-idx="3"] .row-thumb img')).toHaveCount(1);
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    const loupe = page.locator('#loupe');
    await page.locator('.card-row[data-idx="1"] .strip-tile').first().hover();
    await expect(loupe).toBeVisible();
    await expect(loupe.locator('img')).toHaveCount(2);
    await expect(loupe.locator('figcaption').first()).toHaveText('On the page');
    await page.close();
  });

  test('a row whose printing is still open sits under "Pick printing", not among the priced rows', async () => {
    const page = await popupWithChoose(pricedScan);
    await expect(page.locator('.pick-head')).toHaveText('Pick a version (1)');
    await expect(page.locator('.priced-head')).toHaveText('Priced (3)');
    await expect(page.locator('.lt-done')).toHaveCount(0);
    // Order: the pick-printing row, then the priced rows in scan order.
    const order = await page.locator('#results > .card-row[data-state], #results > .group-head').evaluateAll((els) => els.map((el) => el.dataset.idx ?? el.className.replace('group-head ', '')));
    expect(order).toEqual(['pick-head', '1', 'priced-head', '0', '2', '3']);
    await page.close();
  });

  test('at 2505 px wide nothing overflows, rows keep their own heights, and names stop at two lines with the full name in the title', async () => {
    const page = await popupWithChoose(pricedScan);
    await page.setViewportSize({ width: 2505, height: 1272 });
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await expect(page.locator('.card-row[data-idx="2"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#results > .priced-head ~ .card-row')];
      const lineHeight = (el) => parseFloat(getComputedStyle(el).lineHeight);
      const name = document.querySelector('.card-row[data-idx="2"] .card-name');
      const results = document.getElementById('results');
      return {
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        resultsOver: results.scrollWidth - results.clientWidth,
        heights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
        tops: rows.map((r) => Math.round(r.getBoundingClientRect().top)),
        nameLines: Math.round(name.getBoundingClientRect().height / lineHeight(name)),
        nameTitle: name.title,
        align: getComputedStyle(results).alignItems,
        textWidth: document.querySelector('.card-row[data-idx="0"] .card-meta').getBoundingClientRect().width,
        rightmost: Math.max(...rows.map((r) => r.getBoundingClientRect().right)),
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(m.over).toBeLessThanOrEqual(1);
    expect(m.resultsOver).toBeLessThanOrEqual(1);
    expect(m.rightmost).toBeLessThanOrEqual(m.clientWidth + 1);
    expect(m.align).toBe('start');
    // Rows on the same grid line keep their own heights.
    const line = m.heights.filter((_, i) => m.tops[i] === m.tops[0]);
    expect(new Set(m.heights).size).toBeGreaterThan(1);
    expect(line.length).toBeGreaterThan(1);
    expect(m.nameLines).toBeLessThanOrEqual(2);
    expect(m.nameTitle).toContain('Mega Zygarde ex with a very long name');
    expect(m.textWidth).toBeGreaterThanOrEqual(160);
    await page.close();
  });

  for (const width of [360, 420, 720, 1440, 2560]) {
    test(`no horizontal overflow at ${width} px with priced rows`, async () => {
      const page = await popupWithChoose(pricedScan);
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
      await expect(page.locator('.card-row[data-idx="2"]')).toBeVisible();
      const m = await page.evaluate(() => {
        const results = document.getElementById('results');
        return {
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          resultsOver: results.scrollWidth - results.clientWidth,
          text: Math.min(...[...document.querySelectorAll('#results > .card-row:not(.choose-row) .card-meta')].map((el) => el.getBoundingClientRect().width)),
        };
      });
      expect(m.over).toBeLessThanOrEqual(1);
      expect(m.resultsOver).toBeLessThanOrEqual(1);
      expect(m.text).toBeGreaterThanOrEqual(160);
      await page.close();
    });
  }

  test('after the last confirm the list is the final pricing screen: "Priced (n)", "All cards priced", each row with name and price', async () => {
    const page = await popupWithChoose(pricedScan);
    // Settle the printing, then confirm the one card to choose.
    await page.locator('.card-row[data-idx="1"] .strip-tile').nth(1).click();
    await expect(page.locator('.pick-head')).toHaveCount(0);
    await expect(page.locator('.lt-done')).toHaveCount(0);
    await page.locator('.choose-row[data-idx="4"] [data-confirm-best]').click();
    await expect(page.locator('.priced-head')).toHaveText('Priced (5)');
    await expect(page.locator('.lt-done')).toHaveText('All cards priced');
    await expect(page.locator('.choose-group')).toHaveCount(0);
    // Settled rows are one line until opened: open them all to see their Change buttons.
    for (const idx of [0, 1, 3, 4]) await expandRow(page, idx);
    const rows = await page.locator('#results > .card-row').evaluateAll((els) => els.map((el) => [el.dataset.idx, el.querySelector('.card-name').firstChild.textContent.trim().slice(0, 12), el.querySelector('.card-price').textContent.trim()]));
    expect(rows).toEqual([
      ['0', 'Pikachu', '$5.00'], ['1', 'Eevee', '$9.00'], ['2', 'Mega Zygarde', '$3.00–$9.00'], ['3', 'Leafeon', '$5.00'], ['4', 'Pidgey', '$3.00'],
    ]);
    // Every priced row has a visible Change button of at least 32 px.
    const heights = await page.locator('#results > .card-row [data-via="wrong-card"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights).toHaveLength(5);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(32);
    await page.close();
  });

  const changeScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[1]);
    const cards = [
      { identity: row('x-1', 'Pikachu', 'Base', 'base1', '58'), confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), candidates: [a1, b2], crop, box: [0, 0, 1, 1] },
      { identity: row('x-2', 'Raichu', 'Base', 'base1', '14'), confidence: 0.9, abstain: false, market_price: 7, price_grid: grid(7), crop, box: [0, 0, 1, 1] },
    ];
    const priced = { 'b-2': { identity: b2, market_price: 4, price_variant: 'normal', price_grid: grid(4) }, 'f-1': { identity: row('f-1', 'Raichu LV.X', 'Base', 'base1', '15'), market_price: 20, price_variant: 'normal', price_grid: grid(20) } };
    return { cards, priced, found: [row('f-1', 'Raichu LV.X', 'Base', 'base1', '15', arts[2])] };
  };

  test('Change on a priced card with candidates reopens its Choose layout in place; picking another card updates the row and the total; Cancel and Escape restore it', async () => {
    const page = await popupWithChoose(changeScan);
    await expect(page.locator('#s-value')).toHaveText('$12.00');
    await expandRow(page, 0);
    const change = page.locator('.card-row[data-idx="0"] [data-via="wrong-card"]');
    await expect(change).toHaveText('Change');
    await expect(change).toHaveAttribute('aria-label', 'Change Pikachu, pick the right card');
    // Cancel restores the row.
    await change.click();
    const open = page.locator('.card-row.changing[data-idx="0"]');
    await expect(open.locator('.scanned-card img')).toHaveCount(1);
    await expect(open.locator('.pick-choice')).toHaveCount(2);
    await expect(open.locator('.pick-best')).toHaveCount(1);
    await expect(open.locator('[data-confirm-best]')).toBeVisible();
    await expect(page.locator('#s-value')).toHaveText('$12.00');
    await open.locator('[data-cancel-change]').click();
    await expect(page.locator('.card-row.changing')).toHaveCount(0);
    await expect(page.locator('.card-row[data-idx="0"] .card-name')).toContainText('Pikachu');
    await expect(change).toBeFocused();
    // Escape restores it too.
    await change.click();
    await expect(page.locator('.card-row.changing[data-idx="0"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-row.changing')).toHaveCount(0);
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    // Picking another card replaces the row and the total.
    await change.click();
    await page.locator('.card-row.changing .pick-choice[data-pick="b-2"]').click();
    await expect(page.locator('.card-row[data-idx="0"] .card-name')).toContainText('Rattata');
    await expect(page.locator('.card-row[data-idx="0"] .card-price')).toHaveText('$4.00');
    await expect(page.locator('.card-row.changing')).toHaveCount(0);
    await expect(page.locator('#s-value')).toHaveText('$11.00');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', index: 0, pickedId: 'b-2', via: 'wrong-card' });
    await page.close();
  });

  // Two cards to choose, each with its own page picture, so the dock and the preview can be told apart.
  const twoCropsScan = (crop, arts) => {
    const mk = (color) => {
      const cv = document.createElement('canvas');
      cv.width = 126; cv.height = 176;
      const g = cv.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, 126, 176);
      return cv.toDataURL('image/jpeg');
    };
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const cards = [
      { identity: null, confidence: 0.3, abstain: true, candidates: [row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[0]), row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[1])], crop: mk('#c02020'), box: [0, 0, 1, 1] },
      { identity: null, confidence: 0.3, abstain: true, candidates: [row('c-3', 'Spearow', 'Jungle', 'base2', '62', arts[2]), row('d-4', 'Zubat', 'Fossil', 'base3', '57', arts[3])], crop: mk('#2040c0'), box: [0, 0, 1, 1] },
    ];
    return { cards, priced: {} };
  };

  test('two-pane: the dock shows the hovered row\'s crop and the preview opens at the same top-left for tiles in different rows', async () => {
    const page = await popupWithChoose(twoCropsScan);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    const loupe = page.locator('#loupe');
    const dockImg = page.locator('#dock-img');
    await expect(page.locator('#compare-dock')).toBeHidden();
    const crops = await page.locator('.choose-row .scanned-card img').evaluateAll((els) => els.map((e) => e.src));
    expect(crops[0]).not.toBe(crops[1]);
    const probe = async () => page.evaluate(() => {
      const l = document.getElementById('loupe').getBoundingClientRect();
      const d = document.getElementById('dock-img').getBoundingClientRect();
      const side = document.querySelector('.side').getBoundingClientRect();
      return { left: Math.round(l.left), top: Math.round(l.top), dockTop: Math.round(d.top), dockH: Math.round(d.height), sideRight: Math.round(side.right), imgH: Math.round(document.querySelector('#loupe img').getBoundingClientRect().height), panels: document.querySelectorAll('#loupe .loupe-panel').length };
    });
    await page.locator('.choose-row[data-idx="0"] .pick-choice').first().hover();
    await expect(loupe).toBeVisible();
    await expect(dockImg).toHaveAttribute('src', crops[0]);
    const first = await probe();
    await page.mouse.move(5, 500);
    await page.locator('.choose-row[data-idx="1"] .pick-choice').nth(1).hover();
    await expect(dockImg).toHaveAttribute('src', crops[1]);
    await expect(loupe).toBeVisible();
    const second = await probe();
    expect(second.left).toBe(first.left);
    expect(second.top).toBe(first.top);
    expect(first.panels).toBe(1);
    expect(first.left).toBeGreaterThanOrEqual(first.sideRight);
    expect(first.top + 12).toBe(first.dockTop); // the image top sits on the dock image top (12 px padding)
    expect(Math.abs(first.imgH - first.dockH)).toBeLessThanOrEqual(1);
    // Leaving closes the preview; the dock keeps the last crop. Hovering a crop shows it in the dock and opens no preview.
    await page.mouse.move(700, 880);
    await expect(loupe).toBeHidden();
    await expect(dockImg).toHaveAttribute('src', crops[1]);
    await page.locator('.choose-row[data-idx="0"] .scanned-card').hover();
    await expect(dockImg).toHaveAttribute('src', crops[0]);
    await page.waitForTimeout(300);
    await expect(loupe).toBeHidden();
    await page.close();
  });

  test('narrow: the preview keeps both panels and sits in the same spot whichever tile in the same half is hovered', async () => {
    const page = await popupWithChoose(twoCropsScan);
    await page.setViewportSize({ width: 500, height: 760 });
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await expect(page.locator('#compare-dock')).toBeHidden();
    const loupe = page.locator('#loupe');
    const spot = () => page.evaluate(() => { const r = document.getElementById('loupe').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), panels: document.querySelectorAll('#loupe .loupe-panel').length }; });
    const tiles = page.locator('.choose-row[data-idx="0"] .pick-choice');
    await tiles.nth(0).scrollIntoViewIfNeeded();
    const boxes = await tiles.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));
    await tiles.nth(0).hover();
    await expect(loupe).toBeVisible();
    const a = await spot();
    await page.mouse.move(5, 5);
    await tiles.nth(1).hover();
    await expect(loupe).toBeVisible();
    const b = await spot();
    expect(a.panels).toBe(2);
    expect(b).toEqual(a);
    // The spot follows the window's half, never the tile: opposite half of the pointer.
    expect(a.top === 8 ? boxes[0] > 380 : boxes[0] <= 380).toBe(true);
    await page.close();
  });

  // Two priced cards that both keep candidates; card 0's own card is among its candidates (best match first).
  const sameCardScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const pika = row('x-1', 'Pikachu', 'Base', 'base1', '58', arts[0]);
    const rai = row('x-2', 'Raichu', 'Base', 'base1', '14', arts[1]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[2]);
    const cards = [
      { identity: pika, confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), candidates: [pika, b2], crop, box: [0, 0, 1, 1] },
      { identity: rai, confidence: 0.9, abstain: false, market_price: 7, price_grid: grid(7), candidates: [rai, b2], crop, box: [0, 0, 1, 1] },
    ];
    return { cards, priced: { 'x-1': { identity: pika, market_price: 5, price_variant: 'normal', price_grid: grid(5) }, 'b-2': { identity: b2, market_price: 4, price_variant: 'normal', price_grid: grid(4) } } };
  };

  test('removing a card that is in Change, then Put back, returns the confirmed row, not an open Choose row', async () => {
    const page = await popupWithChoose(sameCardScan);
    await expandRow(page, 0);
    await page.locator('.card-row[data-idx="0"] [data-via="wrong-card"]').click();
    await expect(page.locator('.card-row.changing[data-idx="0"]')).toHaveCount(1);
    await page.locator('.card-row.changing[data-idx="0"] [data-remove-card]').click();
    await expect(page.locator('.card-row[data-idx="0"]:not(.skipped-row)')).toHaveCount(0);
    await page.locator('.skipped-toggle').click();
    await page.locator('.skipped-row[data-idx="0"] [data-put-back]').click();
    await expect(page.locator('.card-row[data-idx="0"]')).toBeVisible();
    await expect(page.locator('.card-row.changing')).toHaveCount(0);
    await expect(page.locator('.choose-row[data-idx="0"]')).toHaveCount(0);
    await page.close();
  });

  test('Change, then Confirm on the card the row already has, is a Cancel: nothing is sent and the row is restored', async () => {
    const page = await popupWithChoose(sameCardScan);
    await expandRow(page, 0);
    const change = page.locator('.card-row[data-idx="0"] [data-via="wrong-card"]');
    await change.click();
    await page.locator('.card-row.changing[data-idx="0"] [data-confirm-best]').click();
    await expect(page.locator('.card-row.changing')).toHaveCount(0);
    await expect(page.locator('.card-row[data-idx="0"] .card-name')).toContainText('Pikachu');
    await expect(change).toBeFocused();
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    expect(await page.evaluate(() => window.__priceCalls.length)).toBe(0);
    // The same card's own tile does the same.
    await change.click();
    await page.locator('.card-row.changing[data-idx="0"] .pick-choice[data-pick="x-1"]').click();
    await expect(page.locator('.card-row.changing')).toHaveCount(0);
    expect(await page.evaluate(() => window.__sent.length)).toBe(0);
    await page.close();
  });

  test('only one row is in Change at a time', async () => {
    const page = await popupWithChoose(sameCardScan);
    await expandRow(page, 0);
    await expandRow(page, 1);
    await page.locator('.card-row[data-idx="0"] [data-via="wrong-card"]').click();
    await expect(page.locator('.card-row.changing')).toHaveCount(1);
    await page.locator('.card-row[data-idx="1"] [data-via="wrong-card"]').click();
    await expect(page.locator('.card-row.changing')).toHaveCount(1);
    await expect(page.locator('.card-row.changing')).toHaveAttribute('data-idx', '1');
    await expect(page.locator('.card-row[data-idx="0"]:not(.changing)')).toHaveCount(1);
    await page.close();
  });

  test('the status toast never covers the dock image', async () => {
    const page = await popupWithChoose(twoCropsScan);
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await page.locator('.choose-row[data-idx="0"] .pick-choice').first().hover();
    await expect(page.locator('#compare-dock')).toBeVisible();
    await page.evaluate(() => { const m = document.getElementById('msg-bar'); m.textContent = 'Found 2 cards: 2 need your pick, a long line so the toast takes three lines like a real scan summary does.'; m.classList.remove('hidden', 'fading'); });
    const m = await page.evaluate(() => {
      const t = document.getElementById('msg-bar').getBoundingClientRect();
      const d = document.getElementById('dock-img').getBoundingClientRect();
      return { toastTop: Math.round(t.top), toastBottom: Math.round(t.bottom), imgTop: Math.round(d.top), imgBottom: Math.round(d.bottom), vh: window.innerHeight };
    });
    expect(m.imgBottom).toBeLessThanOrEqual(m.toastTop);
    await page.close();
  });

  test('Change on a priced card without candidates opens the search with the card\'s picture beside the results', async () => {
    const page = await popupWithChoose(changeScan);
    const row = page.locator('.card-row[data-idx="1"]');
    await expandRow(page, 1);
    await row.locator('[data-via="wrong-card"]').click();
    await expect(row.locator('.picker-change .scanned-card img')).toHaveCount(1);
    await row.locator('.picker-input').fill('rai');
    await expect(row.locator('.picker-results [data-pick="f-1"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row.locator('.picker-input')).toHaveCount(0);
    await row.locator('[data-via="wrong-card"]').click();
    await row.locator('.picker-input').fill('rai');
    await row.locator('.picker-results [data-pick="f-1"]').click();
    await expect(row.locator('.card-name')).toContainText('Raichu LV.X');
    await expect(page.locator('#s-value')).toHaveText('$25.00');
    await page.close();
  });

  // ─── One interaction model (spec section 10): hover previews, click acts ───

  // What the page's content script sends to every extension page; a second extension page stands in for it.
  async function pageSays(msg) {
    const sender = await context.newPage();
    await sender.goto(`chrome-extension://${extensionId}/options.html`);
    await sender.evaluate((m) => chrome.runtime.sendMessage(m).catch(() => null), msg);
    await sender.close();
  }

  test('10: the pointer on a card on the page rings its row softly, shows its crop in the dock, never scrolls, and clears on none', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.setViewportSize({ width: 1440, height: 520 });
    await page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await expect(page.locator('#compare-dock')).toBeHidden();
    const scrollOf = () => page.evaluate(() => [window.scrollY, ...[...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => e.scrollTop)].join(','));
    const before = await scrollOf();
    await pageSays({ action: 'overlayHover', index: 3 });
    const row = page.locator('.choose-row[data-idx="3"]');
    await expect(row).toHaveClass(/page-linked/);
    await expect(page.locator('.card-row.page-linked')).toHaveCount(1);
    const ring = await row.evaluate((el) => getComputedStyle(el).outlineColor);
    const tint = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--brand-tint)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    expect(ring).toBe(tint);
    const crop = await row.locator('.scanned-card img').evaluate((e) => e.src);
    await expect(page.locator('#dock-img')).toHaveAttribute('src', crop);
    await expect(page.locator('#compare-dock')).toBeVisible();
    expect(await scrollOf()).toBe(before);
    // Another card moves the ring; none clears it and the dock keeps the last crop.
    await pageSays({ action: 'overlayHover', index: 0 });
    await expect(page.locator('.card-row.page-linked')).toHaveCount(1);
    await expect(page.locator('.card-row[data-idx="0"]')).toHaveClass(/page-linked/);
    await pageSays({ action: 'overlayHover', index: null });
    await expect(page.locator('.card-row.page-linked')).toHaveCount(0);
    // The ring survives the list being redrawn while the pointer rests on the page card.
    await pageSays({ action: 'overlayHover', index: 3 });
    await page.locator('.choose-row[data-idx="3"] [data-confirm-best]').click();
    await expect(page.locator('.card-row[data-idx="3"]')).toHaveClass(/page-linked/);
    await page.close();
  });

  test('10: a hover message with a bad index is ignored', async () => {
    const page = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(toConfirmOf(page)).toHaveText('To confirm (4)');
    await pageSays({ action: 'overlayHover', index: 'x' });
    await pageSays({ action: 'overlayHover', index: 1.5 });
    await page.waitForTimeout(300);
    await expect(page.locator('.card-row.page-linked')).toHaveCount(0);
    await page.close();
  });

  test('10: a pick leaves a Change button in the toast that opens that row\'s Change', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="3"] [data-confirm-best]').click();
    const action = page.locator('#msg-bar button.toast-action');
    await expect(action).toHaveText('Change');
    await action.click();
    await expect(page.locator('.card-row.changing[data-idx="3"]')).toHaveCount(1);
    await expect(page.locator('#msg-bar')).toBeHidden();
    await page.close();
  });

  test('10: a skip leaves a Put back button in the toast that puts the card back', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(page.locator('#msg-bar')).toHaveText(/^Skipped\. 3 to confirm\.Put back$/);
    await page.locator('#msg-bar button.toast-action').click();
    await expect(page.locator('.choose-row[data-idx="1"]')).toHaveCount(1);
    await expect(page.locator('.skipped-group')).toHaveCount(0);
    await expect(page.locator('#msg-bar')).toHaveText('Put back. 4 to confirm.');
    const sent = await page.evaluate(() => window.__sent.map((m) => [m.action, m.index]));
    expect(sent).toEqual([['saveSkip', 1], ['unskip', 1]]);
    await page.close();
  });

  test('10: removing a card from the list leaves a Put back button, and the old where-to-find-it text is gone', async () => {
    const page = await popupWithChoose(chooseScan);
    await expandRow(page, 0);
    await page.locator('.card-row[data-idx="0"] [data-remove-card]').click();
    await expect(page.locator('#msg-bar')).toHaveText('Removed card 1. It is left out of the total.Put back');
    await page.locator('#msg-bar button.toast-action').click();
    await expect(page.locator('.skipped-row[data-idx="0"]')).toHaveCount(0);
    await expect(page.locator('.card-row[data-idx="0"]')).toBeVisible();
    await page.close();
  });

  test('10: a toast with an action stays about 8 s, not 5, and does not fade while hovered', async () => {
    test.setTimeout(60_000);
    const page = await popupWithChoose(chooseScan);
    const toast = page.locator('#msg-bar');
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(toast.locator('button.toast-action')).toBeVisible();
    await page.waitForTimeout(5800);
    await expect(toast).not.toHaveClass(/fading/);
    await expect(toast).toHaveClass(/fading/, { timeout: 4000 });
    // Hovered: held on screen past the 8 s, and the timer starts again when the pointer leaves.
    await page.locator('.choose-row[data-idx="3"] [data-skip-card]').click();
    await expect(toast.locator('button.toast-action')).toBeVisible();
    await toast.hover();
    await page.waitForTimeout(8600);
    await expect(toast).not.toHaveClass(/fading/);
    await page.mouse.move(700, 100);
    await expect(toast).toHaveClass(/fading/, { timeout: 12_000 });
    await page.close();
  });

  test('10: a plain toast still fades after 5 s', async () => {
    test.setTimeout(30_000);
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await page.locator('#msg-bar button.toast-action').click(); // Put back: its own message has no button
    const toast = page.locator('#msg-bar');
    await expect(toast).toHaveText('Put back. 4 to confirm.');
    await expect(toast.locator('button')).toHaveCount(0);
    const t = Date.now();
    await expect(toast).toHaveClass(/fading/, { timeout: 7000 });
    expect(Date.now() - t).toBeGreaterThan(3500);
    expect(Date.now() - t).toBeLessThan(6500);
    await page.close();
  });

  test('10: the "On the page" crop and a candidate tile show their hover and focus style', async () => {
    const page = await popupWithChoose(chooseScan);
    const crop = page.locator('.choose-row[data-idx="1"] .scanned-card');
    const brackets = () => crop.evaluate((el) => getComputedStyle(el, '::before').filter);
    expect(await brackets()).toBe('none');
    await crop.hover();
    await expect.poll(brackets).not.toBe('none');
    await page.mouse.move(5, 5);
    await expect.poll(brackets).toBe('none');
    await crop.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(crop).toBeFocused();
    await expect.poll(brackets).not.toBe('none');
    await expect(crop).toHaveClass(/scanned-card/);
    // Candidate tiles: a check mark badge on hover and on keyboard focus; hidden at rest.
    const tile = page.locator('.choose-row[data-idx="1"] .pick-choice').nth(1);
    const badge = () => tile.evaluate((el) => getComputedStyle(el, '::before').opacity);
    await page.mouse.move(5, 5);
    await expect.poll(badge).toBe('0');
    await tile.hover();
    await expect.poll(badge).toBe('1');
    await page.mouse.move(5, 5);
    await page.locator('.choose-row[data-idx="1"] .pick-choice').first().focus();
    await page.keyboard.press('Tab');
    await expect(tile).toBeFocused();
    await expect.poll(badge).toBe('1');
    await page.close();
  });

  test('10: a compact row\'s thumbnail is a focusable show-on-page button that asks the page to highlight and scroll to its card', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage;
      window.__hl = [];
      chrome.runtime.sendMessage = async (m) => { if (m?.action === 'highlightCard') window.__hl.push({ index: m.index, scroll: m.scroll }); return real(m); };
    });
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await page.locator('.skipped-toggle').click();
    const thumb = page.locator('.skipped-row[data-idx="1"] button.unrec-thumb');
    await expect(thumb).toHaveAttribute('data-show-on-page', '');
    await expect(thumb).toHaveAccessibleName('Show card 2 on the page');
    await thumb.focus();
    await expect(thumb).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__hl.some((m) => m.index === 1 && m.scroll === true))).toBe(true);
    const bk = await thumb.evaluate((el) => getComputedStyle(el, '::before').filter);
    expect(bk).not.toBe('none'); // keyboard focus brightens its brackets
    await page.close();
  });

  test('10: keyboard focus on a review pair\'s checkbox previews that pair like hovering its picture', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-review').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#bulk-panel .bulk-keep').first()).toBeFocused();
    const loupe = page.locator('#loupe');
    await expect(loupe).toBeVisible();
    await expect(loupe.locator('.loupe-panel')).toHaveCount(2);
    await expect(loupe.locator('figcaption').first()).toHaveText('On the page');
    await page.keyboard.press('Tab');
    await expect(page.locator('#bulk-panel .bulk-keep').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(loupe).toBeHidden();
    await page.close();
  });

  test('10: the page\'s full-size pill message goes through the popup button\'s path: a new tab with the offered photo', async () => {
    const page = await popupWithChoose(chooseScan, { ok: true }, { autoScan: false });
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (m) => {
        const reply = await real(m);
        return m?.action === 'scanPage' ? { ...reply, fullSizePhoto: { url: 'http://127.0.0.1:1/big.jpg', small: 2, cards: 3, side: 2048 } } : reply;
      };
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    });
    await expect(page.locator('#fullsize-notice')).toBeVisible();
    // The new tab is recorded instead of opened (a photo at a closed port would only show an error page).
    await page.evaluate(() => { window.__tabs = []; chrome.permissions.contains = async () => true; chrome.tabs.create = async (o) => { window.__tabs.push(o); return null; }; });
    await pageSays({ action: 'overlayFullSize' });
    await expect.poll(() => page.evaluate(() => window.__tabs)).toEqual([{ url: 'http://127.0.0.1:1/big.jpg', active: true }]);
    await expect(page.locator('#fullsize-notice')).toBeHidden();
    await page.close();
  });

  // A popup whose scan offers a full-size photo at `offerUrl`; permissions.contains answers `granted`, request and tab creation are counted.
  async function popupWithOffer(offerUrl, granted, { recordTabs = false } = {}) {
    const page = await popupWithChoose(chooseScan, { ok: true }, { autoScan: false });
    await page.evaluate(({ offerUrl, granted, recordTabs }) => {
      window.__req = 0; window.__scans = 0; window.__tabs = [];
      const real = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (m) => {
        if (m?.action === 'scanPage') window.__scans += 1;
        const reply = await real(m);
        return m?.action === 'scanPage' ? { ...reply, fullSizePhoto: { url: offerUrl, small: 2, cards: 3, side: 2048 } } : reply;
      };
      chrome.permissions.contains = async () => granted;
      chrome.permissions.request = async () => { window.__req += 1; return false; };
      if (recordTabs) chrome.tabs.create = async (o) => { window.__tabs.push(o); return null; };
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    }, { offerUrl, granted, recordTabs });
    await expect(page.locator('#fullsize-notice')).toBeVisible();
    return page;
  }

  test('10: the pill with site access already granted opens the tab with no request, then the scan runs on it', async () => {
    const offerUrl = `chrome-extension://${extensionId}/options.html?x=fullsize`;
    const page = await popupWithOffer(offerUrl, true);
    await expect.poll(() => page.evaluate(() => window.__scans)).toBe(1);
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('x=fullsize'), timeout: 10_000 });
    await pageSays({ action: 'overlayFullSize' });
    const tab = await opened;
    expect(await page.evaluate(() => window.__req), 'no permission request was made').toBe(0);
    await expect(page.locator('#fullsize-notice')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__scans), { timeout: 10_000 }).toBe(2);
    await tab.close();
    await page.close();
  });

  test('10: the pill without site access does not ask without a gesture: it shows the offer and focuses its button', async () => {
    const page = await popupWithOffer('http://127.0.0.1:1/big.jpg', false, { recordTabs: true });
    await page.evaluate(() => { document.getElementById('fullsize-notice').hidden = true; });
    await pageSays({ action: 'overlayFullSize' });
    await expect(page.locator('#fullsize-notice')).toBeVisible();
    await expect(page.locator('#fullsize-open')).toBeFocused();
    expect(await page.evaluate(() => [window.__req, window.__tabs.length])).toEqual([0, 0]);
    await page.close();
  });

  // The dev build holds <all_urls>, so site access is granted here: the restored window runs the whole path and opens the tab
  // (the no-access path, which shows and focuses the offer's button, is the test above with permissions.contains stubbed).
  test('10: a pill click that opened the window is applied once the lot is restored: the full-size tab opens and the record is consumed', async () => {
    const offerUrl = 'http://127.0.0.1:1/big.jpg';
    const first = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await first.evaluate((offerUrl) => {
      const real = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (m) => {
        const reply = await real(m);
        return m?.action === 'scanPage' ? { ...reply, fullSizePhoto: { url: offerUrl, small: 2, cards: 3, side: 2048 } } : reply;
      };
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    }, offerUrl);
    await expect(first.locator('#fullsize-notice')).toBeVisible();
    await waitSaved(first, (st) => st?.fullSize?.url === offerUrl);
    await first.close();
    const setter = await context.newPage();
    await setter.goto(`chrome-extension://${extensionId}/options.html`);
    await setter.evaluate((url) => chrome.storage.session.set({ pendingShow: { kind: 'fullsize', url, at: Date.now() } }), LOT_URL);
    await setter.close();
    const again = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(again.locator('#restore-note')).toBeVisible();
    // The whole path ran: the tab was created (its address is a closed port, so the proof is the popup's own message) and the offer closed.
    await expect(again.locator('#msg-bar')).toContainText('Opening the full-size photo');
    await expect(again.locator('#fullsize-notice')).toBeHidden();
    await expect.poll(() => again.evaluate(async () => (await chrome.storage.session.get('pendingShow')).pendingShow ?? null)).toBeNull();
    await again.evaluate(() => chrome.storage.session.remove('lotSessions'));
    await again.close();
  });

  test('10 review: Clear closes a toast that offers Change or Put back, and the page ring does not come back with the next lot', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="3"] [data-confirm-best]').click();
    await expect(page.locator('#msg-bar button.toast-action')).toHaveText('Change');
    await pageSays({ action: 'overlayHover', index: 3 });
    await expect(page.locator('.card-row[data-idx="3"]')).toHaveClass(/page-linked/);
    await page.locator('#btn-clear').evaluate((b) => b.click());
    // The Change action is gone; Clear offers its own Undo (11.6), which a new lot also closes.
    await expect(page.locator('#msg-bar button.toast-action')).toHaveText('Undo');
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    await expect(page.locator('.choose-row[data-idx="3"]')).toHaveCount(1);
    await expect(page.locator('#msg-bar button.toast-action')).toHaveCount(0);
    await expect(page.locator('.card-row.page-linked')).toHaveCount(0);
    await page.close();
  });

  // ─── 11.1 / 11.2 journey fixes, slice A (docs/plans/extension-ui-redesign.md) ───

  const WIZARD_SHOTS = path.resolve(__dirname, '../../.tmp/slice-a');
  fs.mkdirSync(WIZARD_SHOTS, { recursive: true });

  // A popup whose background answers checkReady and scanState as stated; the rest is the real background.
  async function popupWithState({ ready = true, tab = { tabUrl: 'https://www.mercari.com/us/item/1', tabId: 3, running: false } } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 720 });
    await page.addInitScript(({ ready, tab }) => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action === 'checkReady') return { ready };
        if (msg?.action === 'scanState') return tab;
        return real(msg);
      };
    }, { ready, tab });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    return page;
  }

  const showWizardStep = (page, id) => page.evaluate((stepId) => {
    document.getElementById('setup-overlay').style.display = 'flex';
    for (const el of document.querySelectorAll('.wiz-section')) el.classList.toggle('active', el.id === stepId);
  }, id);

  test('11.1: the setup steps say what is downloaded, tag steps 2 and 3 Optional and keep a Skip in sight', async () => {
    const page = await popupWithState({ ready: false });
    await showWizardStep(page, 'wiz-step-1');
    await expect(page.locator('#wiz-step-1')).toContainText('One-time download');
    await expect(page.locator('#wiz-step-1')).toContainText('After that, everything runs on your computer. No account needed.');
    await expect(page.locator('#btn-setup')).toHaveText('Download');
    await expect(page.locator('#btn-setup-retry')).toBeHidden();
    await expect(page.locator('#setup-keep')).toBeHidden();
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'step-1-download.png') });
    await showWizardStep(page, 'wiz-step-access');
    await expect(page.locator('#wiz-step-access .wiz-optional')).toBeVisible();
    await expect(page.locator('#wiz-step-access')).toContainText('Read the original, sharper photos on Marketplace? It finds more cards.');
    await expect(page.locator('#wiz-step-access')).not.toContainText('without your cookies');
    await expect(page.locator('#btn-wiz-access')).toHaveAttribute('title', /without your cookies/);
    await expect(page.locator('#btn-wiz-access-skip')).toHaveText('Not now');
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'step-2-access.png') });
    await showWizardStep(page, 'wiz-step-2');
    await expect(page.locator('#wiz-step-2 .wiz-optional')).toBeVisible();
    await expect(page.locator('#btn-wiz-skip')).toHaveText('Skip');
    await expect(page.locator('#btn-wiz-skip')).toBeVisible();
    await expect(page.locator('#wiz-step-2')).not.toContainText(/NM|LP|PSA|BGS|CGC|SGC|DMG/);
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'step-3-price-key.png') });
    await page.close();
  });

  test('11.1: the download shows "Downloading 2 of 3 · 42%" and "Keep this window open"; a failure leaves Retry', async () => {
    const page = await popupWithState({ ready: false });
    await showWizardStep(page, 'wiz-step-1');
    await page.evaluate(() => {
      const listeners = [];
      const onMessage = chrome.runtime.onMessage;
      const add = onMessage.addListener.bind(onMessage);
      onMessage.addListener = (fn) => { listeners.push(fn); add(fn); };
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => {
        if (msg?.action !== 'startSetup') return real(msg);
        for (const fn of listeners) fn({ action: 'setupProgress', file: 'card_detect.onnx', fileIndex: 1, fileDone: false, totalFiles: 3, bytesLoaded: 42, bytesTotal: 100 });
        return new Promise((resolve) => { window.__failDownload = () => resolve({ ok: false, error: 'network' }); });
      };
      document.getElementById('btn-setup').click();
    });
    await expect(page.locator('#setup-status')).toHaveText('Downloading 2 of 3 · 42%');
    await expect(page.locator('#setup-keep')).toBeVisible();
    await expect(page.locator('#setup-keep')).toHaveText('Keep this window open');
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'step-1-downloading.png') });
    await page.evaluate(() => window.__failDownload());
    await expect(page.locator('#btn-setup-retry')).toBeVisible();
    await expect(page.locator('#btn-setup-retry')).toHaveText('Retry');
    await expect(page.locator('#setup-keep')).toBeHidden();
    await expect(page.locator('#setup-status')).toContainText('The download stopped');
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'step-1-retry.png') });
    await page.close();
  });

  test('11.1: a disabled Scan Page says why under the empty mark', async () => {
    const early = await popupWithState({ ready: false });
    await expect(early.locator('#empty-why')).toHaveText('Finish setup first');
    await early.close();
    const wrongTab = await popupWithState({ ready: true, tab: { tabUrl: 'chrome://extensions/', tabId: 3, running: false } });
    await expect(wrongTab.locator('#empty-why')).toHaveText('Open a listing on Facebook Marketplace, Mercari or another site, then press Scan Page');
    await wrongTab.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });
    await wrongTab.screenshot({ path: path.join(WIZARD_SHOTS, 'scan-disabled-reason.png') });
    await wrongTab.close();
    const fine = await popupWithState({ ready: true });
    await expect(fine.locator('#empty-hint')).toBeVisible();
    await expect(fine.locator('#empty-why')).toBeHidden();
    await fine.close();
  });

  test('11.2: while a scan runs the empty state says "Looking for cards…", then "Reading 6 cards…", and the button says Scan again after', async () => {
    const page = await popupWithState({ ready: true });
    await page.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
    await page.evaluate(() => {
      const listeners = [];
      const onMessage = chrome.runtime.onMessage;
      const add = onMessage.addListener.bind(onMessage);
      onMessage.addListener = (fn) => { listeners.push(fn); add(fn); };
      // The background is the sender: an extension id and no tab.
      window.__progress = (msg) => { for (const fn of listeners) fn(msg, { id: chrome.runtime.id }); };
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => (msg?.action === 'scanPage'
        ? new Promise((resolve) => { window.__finishScan = () => resolve({ cards: [{ box: [0, 0, 5, 5], identity: { name: 'Pikachu', number: '1' }, confidence: 0.99 }], scanId: 'x', srcWidth: 10, srcHeight: 10, pending: 0 }); })
        : real(msg));
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    });
    await expect(page.locator('#scan-status')).toHaveText('Looking for cards…');
    await expect(page.locator('#empty-text')).toBeHidden();
    await expect(page.locator('#btn-label')).toHaveText('SCANNING…');
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'scanning-looking.png') });
    await page.evaluate(() => window.__progress({ action: 'scanProgress', found: 6, tabId: 3 }));
    await expect(page.locator('#scan-status')).toHaveText('Reading 6 cards…');
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'scanning-reading.png') });
    // Another tab's scan, and a message with nothing to say, change nothing.
    await page.evaluate(() => { window.__progress({ action: 'scanProgress', found: 99, tabId: 9 }); window.__progress({ action: 'scanProgress', tabId: 3 }); });
    await expect(page.locator('#scan-status')).toHaveText('Reading 6 cards…');
    await page.evaluate(() => window.__finishScan());
    await expect(page.locator('#scan-status')).toBeHidden();
    await expect(page.locator('#btn-label')).toHaveText('SCAN AGAIN');
    await expect(page.locator('#msg-bar')).toHaveText('Found 1 card.');
    await page.locator('#btn-clear').evaluate((b) => b.click());
    await expect(page.locator('#btn-label')).toHaveText('SCAN PAGE');
    await expect(page.locator('#empty-text')).toContainText('Open a page with Pokémon cards');
    await page.close();
  });

  test('11.2: the long breakdown is the To confirm tooltip, and a failed scan names the action', async () => {
    const lot = await popupWithChoose(chooseScan);
    await expect(lot.locator('#msg-bar')).toHaveText('Found 6 cards · 4 need you.');
    await expect(lot.locator('.lt-guess')).toHaveAttribute('title', /Found 6 cards: 2 identified, 4 need your pick/);
    await expect(lot.locator('#btn-label')).toHaveText('SCAN AGAIN');
    await lot.close();
    const failing = await popupWithState({ ready: true });
    await failing.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
    await failing.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => (msg?.action === 'scanPage'
        ? Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
        : real(msg));
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    });
    await expect(failing.locator('#msg-bar')).toHaveText('Reload Sweep at chrome://extensions, then press Scan Page.');
    await failing.close();
  });

  test('11.2: a rescan with a lot shown has the same status line, visible under the Scan button', async () => {
    const page = await popupWithChoose(chooseScan);
    await expect(page.locator('.choose-row').first()).toBeVisible();
    await expect(page.locator('#scan-status')).toBeHidden();
    await page.evaluate(() => {
      const listeners = [];
      const onMessage = chrome.runtime.onMessage;
      const add = onMessage.addListener.bind(onMessage);
      onMessage.addListener = (fn) => { listeners.push(fn); add(fn); };
      window.__progress = (msg) => { for (const fn of listeners) fn(msg, { id: chrome.runtime.id }); };
      const before = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (msg) => (msg?.action === 'scanPage'
        ? new Promise((resolve) => { window.__finishScan = async () => resolve(await before(msg)); })
        : before(msg));
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    });
    await expect(page.locator('#scan-status')).toBeVisible();
    await expect(page.locator('#scan-status')).toHaveText('Looking for cards…');
    await expect(page.locator('#msg-bar')).toBeHidden();
    const where = await page.evaluate(() => {
      const bar = document.querySelector('.action-bar').getBoundingClientRect();
      const status = document.getElementById('scan-status').getBoundingClientRect();
      return { barBottom: bar.bottom, statusTop: status.top };
    });
    expect(where.statusTop).toBeGreaterThanOrEqual(where.barBottom - 1);
    await page.evaluate(() => window.__progress({ action: 'scanProgress', found: 6 }));
    await expect(page.locator('#scan-status')).toHaveText('Reading 6 cards…');
    await page.screenshot({ path: path.join(WIZARD_SHOTS, 'rescan-status-with-lot.png') });
    await page.evaluate(() => window.__finishScan());
    await expect(page.locator('#scan-status')).toBeHidden();
    await page.close();
  });

  test('11.1: a download that throws leaves Retry and an enabled button, not a stuck one', async () => {
    const page = await popupWithState({ ready: false });
    await showWizardStep(page, 'wiz-step-1');
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => (msg?.action === 'startSetup' ? Promise.reject(new Error('The message port closed before a response was received.')) : real(msg));
      document.getElementById('btn-setup').click();
    });
    await expect(page.locator('#btn-setup-retry')).toBeVisible();
    await expect(page.locator('#btn-setup')).toBeEnabled();
    await expect(page.locator('#setup-keep')).toBeHidden();
    await expect(page.locator('#setup-status')).toContainText('The download stopped');
    // Retry runs the download again and can succeed.
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__startSetupCalls = 0;
      chrome.runtime.sendMessage = (msg) => { if (msg?.action === 'startSetup') { window.__startSetupCalls += 1; return Promise.resolve({ ok: false, error: 'again' }); } return real(msg); };
    });
    await page.locator('#btn-setup-retry').click();
    await expect.poll(() => page.evaluate(() => window.__startSetupCalls)).toBe(1);
    await page.close();
  });

  test('11.2: a site-access answer that arrives after a newer scan started does not show the notice', async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 420, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
    await page.evaluate(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      let scans = 0;
      chrome.runtime.sendMessage = async (msg) => {
        if (msg?.action !== 'scanPage') return real(msg);
        scans += 1;
        if (scans === 1) return { cards: [], scanId: 'x', srcWidth: 10, srcHeight: 10, pending: 0, usedScreenshotPath: true, reason: 'no-site-access' };
        return new Promise(() => {}); // the second scan never ends
      };
      chrome.permissions.contains = async () => false;
      chrome.storage.local.remove('siteAccessDismissedAt');
      // The access question's storage read is held until the test lets it go.
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      window.__release = null;
      chrome.storage.local.get = (keys) => (Array.isArray(keys) && keys.includes('siteAccessDismissedAt')
        ? new Promise((resolve) => { window.__release = () => get(keys).then(resolve); })
        : get(keys));
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    });
    await expect.poll(() => page.evaluate(() => window.__release !== null)).toBe(true);
    await expect(page.locator('#btn-label')).toHaveText('SCAN PAGE');
    await page.evaluate(() => { const b = document.getElementById('btn-scan'); b.disabled = false; b.click(); });
    await expect(page.locator('#btn-label')).toHaveText('SCANNING…');
    await page.evaluate(() => window.__release());
    await page.waitForTimeout(500);
    await expect(page.locator('#access-notice')).toBeHidden();
    await page.close();
  });

  test('11.2: notices come one at a time: a restored lot waits while the full-size offer is up', async () => {
    const offerUrl = 'http://127.0.0.1:1/big.jpg';
    const first = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await first.evaluate((offerUrl) => {
      const real = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (m) => {
        const reply = await real(m);
        return m?.action === 'scanPage' ? { ...reply, fullSizePhoto: { url: offerUrl, small: 2, cards: 3, side: 2048 } } : reply;
      };
      const b = document.getElementById('btn-scan'); b.disabled = false; b.click();
    }, offerUrl);
    await expect(first.locator('#fullsize-notice')).toBeVisible();
    await expect(first.locator('#fullsize-text')).toHaveText('Some cards are small. Open the full-size photo to read them better.');
    await expect(first.locator('#fullsize-open')).toHaveText('Open photo');
    await waitSaved(first, (st) => st?.fullSize?.url === offerUrl);
    await first.close();
    const again = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL, autoScan: false });
    await expect(again.locator('#fullsize-notice')).toBeVisible();
    await expect(again.locator('#restore-note')).toBeHidden();
    await again.screenshot({ path: path.join(WIZARD_SHOTS, 'notice-fullsize-first.png') });
    await again.evaluate(() => chrome.storage.session.remove('lotSessions'));
    await again.close();
  });

  // ─── 11.4 to 11.7 journey fixes, slice B ───

  const SLICE_B_SHOTS = path.resolve(__dirname, '../../.tmp/slice-b');
  fs.mkdirSync(SLICE_B_SHOTS, { recursive: true });

  // Two to choose, one with its version open, one priced, one removed, one hidden "not a card", one card back, one too small.
  const countsScan = (crop, arts) => {
    const grid = (nm) => ({ source: 'pokemontcg', variants: { normal: { market: nm, conditions: { NM: nm } } } });
    const row = (id, name, set, setCode, number, art) => ({ id, name, set, setCode, number, imageUrl: art });
    const sets = [row('s-1', 'Eevee', 'Scarlet & Violet', 'sv01', '005', arts[0]), row('s-2', 'Eevee', 'Paldea Evolved', 'sv02', '005', arts[1])];
    const a1 = row('a-1', 'Pidgey', 'Jungle', 'base2', '57', arts[2]);
    const b2 = row('b-2', 'Rattata', 'Base Set', 'base1', '61', arts[3]);
    const choose = { identity: null, confidence: 0.3, abstain: true, candidates: [a1, b2], crop, box: [0, 0, 1, 1] };
    const cards = [
      { identity: row('x-1', 'Pikachu', 'Base', 'base1', '58'), confidence: 0.9, abstain: false, market_price: 5, price_grid: grid(5), crop, box: [0, 0, 1, 1] },
      { identity: sets[0], setChoices: sets, setConfirmed: false, setRange: { low: 2, high: 9, count: 2, total: 2 }, confidence: 0.9, abstain: false, crop, box: [0, 0, 1, 1] },
      choose,
      { ...choose },
      { ...choose, skipped: true, removed: true },
      { notCard: true, cardBack: true, abstain: true, identity: null, confidence: 0, crop, box: [0, 0, 1, 1] },
      { cardBack: true, abstain: true, identity: null, confidence: 0, crop, box: [0, 0, 1, 1] },
      { cardBack: true, tooSmall: true, abstain: true, identity: null, confidence: 0, crop, box: [0, 0, 1, 1] },
    ];
    const priced = { 'a-1': { identity: a1, market_price: 3, price_variant: 'normal', price_grid: grid(3) }, 'b-2': { identity: b2, market_price: 4, price_variant: 'normal', price_grid: grid(4) } };
    return { cards, priced };
  };

  test('11.4: the lot card, the group headings, the review button and the toast all read the same counts', async () => {
    const page = await popupWithChoose(countsScan);
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (2)');
    await expect(page.locator('#lot-totals .lt-guess b')).toHaveText('2');
    await expect(page.locator('.pick-head')).toHaveText('Pick a version (1)');
    await expect(page.locator('#lot-totals .lt-versions .lt-lbl')).toHaveText('Versions to pick');
    await expect(page.locator('#lot-totals .lt-versions b')).toHaveText('1');
    await expect(page.locator('.choose-review')).toHaveText('Review these 2 together');
    await expect(page.locator('#msg-bar')).toHaveText('Found 6 cards · 3 need you.');
    await expect(page.locator('#lot-totals .lt-item').first()).toContainText('· 2 cards');
    await expect(page.locator('#lot-totals .lt-skipped')).toHaveText('Left out 1');
    const dots = await page.locator('#lot-totals .lt-item').evaluateAll((els) => els.map((el) => getComputedStyle(el, '::before').content));
    expect(dots.every((c) => c === 'none' || c === 'normal' || c === '""')).toBe(true);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'counts-agree.png') });
    await page.close();
  });

  test('11.6: the bottom groups are "Not read", "Not a card" and "Left out", each row with its own reason and one chevron style', async () => {
    const page = await popupWithChoose(countsScan);
    await expect(page.locator('.unrec-toggle[data-unrec-toggle]')).toHaveText('Not read (2)');
    await expect(page.locator('#notcard-heading')).toHaveText('Not a card (1)');
    await expect(page.locator('#skipped-heading')).toHaveText('Left out (1)');
    await page.locator('[data-unrec-toggle]').click();
    // Opening the group keeps its heading equal to its rows, whatever other groups hold.
    await expect(page.locator('.unrec-toggle[data-unrec-toggle]')).toHaveText('Not read (2)');
    await expect(page.locator('#unrec-list .unrec-row')).toHaveCount(2);
    await expect(page.locator('#unrec-list .unrec-name').nth(0)).toHaveText('Card 7: Card back. Turn it over.');
    await expect(page.locator('#unrec-list .unrec-name').nth(1)).toHaveText('Card 8: Too small.');
    await page.locator('#skipped-heading').click();
    await expect(page.locator('#skipped-list .unrec-name')).toHaveText('Card 5: Removed.');
    const classes = await page.locator('#results .unrec-toggle').evaluateAll((els) => els.map((el) => el.classList.contains('unrec-toggle')));
    expect(classes).toEqual([true, true, true]);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'bottom-groups.png') });
    await page.close();
  });

  test('11.4: a card with no close match opens its search at once, with its picture beside the results', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const a1 = { id: 'a-1', name: 'Pidgey', set: 'Jungle', setCode: 'base2', number: '57', imageUrl: arts[0] };
      const grid = { source: 'pokemontcg', variants: { normal: { market: 3, conditions: { NM: 3 } } } };
      return {
        cards: [
          { identity: null, confidence: 0.1, abstain: true, candidates: [], crop, box: [0, 0, 1, 1] },
          { identity: null, confidence: 0.3, abstain: true, candidates: [a1], crop, box: [0, 0, 1, 1] },
        ],
        priced: { 'a-1': { identity: a1, market_price: 3, price_variant: 'normal', price_grid: grid } },
        found: [a1],
      };
    });
    // The open search must not stop the other row's best-match price from arriving.
    await expect(page.locator('.choose-row[data-idx="1"] .card-price')).toHaveText('$3.00 · unconfirmed');
    const row = page.locator('.choose-row[data-idx="0"]');
    await expect(row.locator('.picker-sub')).toHaveText('No close match. Search for it, or skip it.');
    await expect(row.locator('.picker-input')).toBeVisible();
    await expect(row.locator('.picker-change .scanned-card img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(row.locator('[data-skip-card]')).toHaveText('Skip this card');
    await expect(row.locator('[data-open-search][data-via="search"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'no-match-row.png') });
    // Searching and picking from its results confirms the card and saves it as a search pick.
    await row.locator('.picker-input').fill('pidgey');
    await row.locator('.picker-results .pick-card').first().click();
    await expect(page.locator('.card-row[data-idx="0"] .card-name')).toContainText('Pidgey');
    const sent = await page.evaluate(() => window.__sent);
    expect(sent[0]).toMatchObject({ action: 'saveCorrection', index: 0, pickedId: 'a-1', via: 'search' });
    await page.close();
  });

  test('11.4: the Confirm button shows the whole name on up to two lines, even at 360 px', async () => {
    const page = await popupWithChoose((crop, arts) => ({
      cards: [{ identity: null, confidence: 0.3, abstain: true, crop, box: [0, 0, 1, 1],
        candidates: [{ id: 'm-1', name: 'Mega Charizard X ex Special Illustration', set: 'Phantasmal Flames', setCode: 'me2', number: '125', imageUrl: arts[0] }, { id: 'm-2', name: 'Pidgey', set: 'Jungle', setCode: 'base2', number: '57', imageUrl: arts[1] }] }],
      priced: {},
    }));
    await page.setViewportSize({ width: 360, height: 720 });
    const button = page.locator('.choose-row .choose-confirm');
    await expect(button).toHaveText('Confirm Mega Charizard X ex Special Illustration');
    const fit = await button.evaluate((el) => ({ over: el.scrollWidth - el.clientWidth, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)), width: el.getBoundingClientRect().width }));
    expect(fit.over).toBeLessThanOrEqual(1);
    expect(fit.lines).toBeLessThanOrEqual(3);
    expect(fit.width).toBeGreaterThanOrEqual(190);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'confirm-two-lines-360.png') });
    await page.close();
  });

  test('11.4: pressing anything in the results list closes the toast, and a skip still offers Put back', async () => {
    const page = await popupWithChoose(chooseScan);
    await page.locator('.choose-row[data-idx="1"] [data-skip-card]').click();
    await expect(page.locator('#msg-bar')).toHaveText(/^Skipped\./);
    await page.locator('.choose-row[data-idx="3"] .picker-title').click();
    await expect(page.locator('#msg-bar')).toBeHidden();
    await page.locator('.choose-row[data-idx="3"] [data-skip-card]').click();
    await expect(page.locator('#msg-bar')).toContainText('Put back');
    await page.close();
  });

  test('11.5: the version strip asks "Which version is it?", says why, and after a pick says "Picked: ..." and keeps the strip', async () => {
    const page = await popupWithChoose(pricedScan);
    const row = page.locator('.card-row[data-idx="1"]');
    await expect(row.locator('.set-select-row .lbl')).toHaveText('Which version is it?');
    await expect(row.locator('.set-select-row .strip-sub')).toHaveText('Several versions. Pick yours for the exact price.');
    await expect(row).not.toContainText(/Pick printing|Set not sure|SET\?/i);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'version-strip-open.png') });
    await row.locator('.set-select-row [data-strip-pick="s-2"]').click();
    await expandRow(page, 1); // the pick settled the row, so it collapsed
    await expect(page.locator('.card-row[data-idx="1"] .set-select-row .lbl')).toHaveText('Picked: Paldea Evolved');
    await expect(page.locator('.card-row[data-idx="1"] .set-select-row [data-strip-pick]')).not.toHaveCount(0);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'version-strip-picked.png') });
    await page.close();
  });

  test('11.6: Clear with a lot shows "Cleared 5 cards" with Undo, and Undo puts the list back exactly', async () => {
    const page = await popupWithChoose(pricedScan);
    await expect(page.locator('.priced-head')).toHaveText('Priced (3)');
    const before = await page.locator('#results').innerHTML();
    const totalsBefore = await page.locator('#lot-totals').innerHTML();
    await page.locator('#btn-clear').click();
    await expect(page.locator('#msg-bar')).toHaveText('Cleared 5 cardsUndo');
    await expect(page.locator('.card-row')).toHaveCount(0);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'cleared-undo.png') });
    await page.locator('#msg-bar .toast-action').click();
    await expect(page.locator('.priced-head')).toHaveText('Priced (3)');
    expect(await page.locator('#results').innerHTML()).toBe(before);
    expect(await page.locator('#lot-totals').innerHTML()).toBe(totalsBefore);
    // The summary line comes back with the lot.
    await expect(page.locator('#msg-bar')).toContainText('Found 5 cards');
    await page.close();
  });

  test('11.6 review: Undo brings back an open "Not a card" group', async () => {
    const page = await popupWithChoose(countsScan);
    await page.locator('[data-notcard-toggle]').click();
    await expect(page.locator('#notcard-list')).toBeVisible();
    await page.locator('#btn-clear').click();
    await page.locator('#msg-bar .toast-action').click();
    await expect(page.locator('#notcard-list')).toBeVisible();
    await page.close();
  });

  test('11.6: Clear with nothing shown offers no Undo', async () => {
    const page = await popupWithState({ ready: true });
    await page.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
    await page.locator('#btn-clear').evaluate((b) => b.click());
    await expect(page.locator('#msg-bar .toast-action')).toHaveCount(0);
    await page.close();
  });

  test('11.7: the header says "Add card" from 560 px up and is icon-only with the same tooltip below; the title never wraps; the slider and eye have tooltips', async () => {
    const page = await popupWithState({ ready: true });
    await page.addStyleTag({ content: '#setup-overlay { display: none !important; }' });
    await page.setViewportSize({ width: 600, height: 640 });
    const draw = page.locator('#btn-draw');
    await expect(draw.locator('.draw-label')).toBeVisible();
    await expect(draw).toHaveText('Add card');
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'header-600.png'), clip: { x: 0, y: 0, width: 600, height: 70 } });
    await page.setViewportSize({ width: 500, height: 640 });
    expect((await draw.boundingBox()).width).toBeLessThanOrEqual(40);
    // The title stays on one line at every width.
    const lines = await page.locator('.logo').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].filter((r) => r.width > 40).map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(1);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'header-500.png'), clip: { x: 0, y: 0, width: 500, height: 70 } });
    await page.setViewportSize({ width: 400, height: 640 });
    const small = await draw.boundingBox();
    expect(small.width).toBeLessThanOrEqual(40);
    await expect(draw).toHaveAttribute('title', /^Add card/);
    await expect(draw).toHaveAccessibleName(/Add card/);
    await page.screenshot({ path: path.join(SLICE_B_SHOTS, 'header-400.png'), clip: { x: 0, y: 0, width: 400, height: 70 } });
    await expect(page.locator('#size-ctl')).toHaveAttribute('title', 'Picture size');
    await expect(page.locator('.overlay-toggle')).toHaveAttribute('title', 'Show or hide the boxes on the page');
    await page.close();
  });

  // Holds the answer to one priceCard id until the test releases it with the card it should price to.
  const holdPrice = (page, id) => page.evaluate((heldId) => {
    const prev = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (msg) => (msg?.action === 'priceCard' && msg.id === heldId
      ? new Promise((resolve) => {
        window.__release = () => resolve({ identity: { id: heldId, name: 'Pidgey', set: 'Jungle', setCode: 'base2', number: '57' }, market_price: 3, price_variant: 'normal',
          price_grid: { source: 'pokemontcg', variants: { normal: { market: 3, conditions: { NM: 3 } } } } });
      })
      : prev(msg));
  }, id);

  test('11.6 review: a price still loading when the lot is cleared is asked for again by Undo, and lands', async () => {
    const page = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(page.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await holdPrice(page, 'a-1');
    await page.locator('.choose-row[data-idx="1"] .pick-choice[data-pick="a-1"]').click();
    await expect(page.locator('.card-row[data-idx="1"] .card-price')).toHaveText('…');
    await page.locator('#btn-clear').click();
    // The price arrives while the list is cleared: the pick's own answer is dropped as stale.
    await page.evaluate(() => window.__release());
    await page.waitForTimeout(150);
    await page.locator('#msg-bar .toast-action').click();
    await expect(page.locator('.card-row[data-idx="1"]')).toBeVisible();
    await expect(page.locator('.card-row[data-idx="1"] .card-price')).toHaveText('$3.00');
    await expect(page.locator('#results .card-price', { hasText: '…' })).toHaveCount(0);
    await expect(page.locator('#lot-totals .lt-guess b')).toHaveText('3');
    await expect(page.locator('.card-row[data-idx="1"] .card-name')).toContainText('Pidgey');
    await page.close();
  });

  test('11.6 review: Undo restores on the same page and says to scan again when the page has changed', async () => {
    const same = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(same.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await same.locator('#btn-clear').click();
    await same.locator('#msg-bar .toast-action').click();
    await expect(same.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await same.close();
    const moved = await popupWithChoose(chooseScan, { ok: true }, { tabUrl: LOT_URL });
    await expect(moved.locator('.choose-toggle')).toHaveText('To confirm (4)');
    await moved.locator('#btn-clear').click();
    await moved.evaluate(() => {
      const prev = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = (msg) => (msg?.action === 'scanState' ? Promise.resolve({ tabUrl: 'https://other.example/item/9', running: false }) : prev(msg));
    });
    await moved.locator('#msg-bar .toast-action').click();
    await expect(moved.locator('#msg-bar')).toHaveText('The page has changed. Scan it again.');
    await expect(moved.locator('.card-row')).toHaveCount(0);
    await moved.close();
  });

  test('11.4 review: pressing in the list closes an action toast but not the scan summary', async () => {
    const page = await popupWithChoose(chooseScan);
    await expect(page.locator('#msg-bar')).toHaveText('Found 6 cards · 4 need you.');
    await page.locator('.choose-row[data-idx="3"] .picker-title').click();
    await expect(page.locator('#msg-bar')).toHaveText('Found 6 cards · 4 need you.');
    await page.close();
  });

  test('11.5 review: "Picked: <set>" shows only for a version the user picked', async () => {
    const page = await popupWithChoose((crop, arts) => {
      const grid = { source: 'pokemontcg', variants: { normal: { market: 3, conditions: { NM: 3 } } } };
      const sets = [
        { id: 's-1', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51', imageUrl: arts[0] },
        { id: 's-2', name: 'Eevee', set: 'Fossil', setCode: 'base3', number: '51', imageUrl: arts[1] },
      ];
      return {
        cards: [{ identity: sets[0], setChoices: sets, setConfirmed: true, confidence: 0.9, abstain: false, market_price: 3, price_grid: grid, crop, box: [0, 0, 1, 1] }],
        priced: { 's-1': { identity: sets[0], market_price: 3, price_variant: 'normal', price_grid: grid }, 's-2': { identity: sets[1], market_price: 3, price_variant: 'normal', price_grid: grid } },
      };
    });
    await expandRow(page, 0); // a settled row is one line until opened
    await expect(page.locator('.set-select-row .lbl')).toHaveText('Which version is it?');
    await page.locator('.set-select-row [data-strip-pick="s-2"]').click();
    await expect(page.locator('.set-select-row .lbl')).toHaveText('Picked: Fossil');
    await page.close();
  });

  test('11.7: the settings page names the switch and counts cards remembered', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#corrections-card .source-desc').first()).toContainText('unless you turn on Help improve recognition for everyone.');
    await expect(page.locator('#references-count')).toHaveText(/^\d+ cards? remembered$/);
    await page.close();
  });
});
