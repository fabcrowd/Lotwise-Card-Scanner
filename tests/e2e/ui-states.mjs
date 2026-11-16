/**
 * Screenshots of every state of the extension popup and options page, from fixture data only.
 * Loads the built dev extension (dist/extension-wasm), so rebuild first:
 *   powershell -ExecutionPolicy Bypass -File scripts/build-wasm-extension.ps1
 * Run: node tests/e2e/ui-states.mjs <label>
 * Output: .tmp/ui-shots/<label>/<state>-<scheme>.png and manifest.json.
 *
 * Fixture cards reach the popup the way extension-wasm-popup.spec.js does it: the popup's scan message is answered
 * by a stub, so no scan, network or model is involved. "natural" in the manifest means the state was reached by
 * clicking the real buttons on that fixture list; "forced" means the DOM was set directly.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const EXT = path.join(ROOT, 'dist/extension-wasm');
const label = process.argv[2];
if (!label || !/^[\w.-]+$/.test(label)) {
  console.error('usage: node tests/e2e/ui-states.mjs <label>');
  process.exit(2);
}
const OUT = path.join(ROOT, '.tmp', 'ui-shots', label);
fs.mkdirSync(OUT, { recursive: true });

const SCHEMES = ['light', 'dark'];
const manifest = [];

// ---------- fixtures ----------

async function art(hue, text, type = 'png') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342">
    <rect width="245" height="342" rx="14" fill="hsl(${hue},55%,42%)"/>
    <rect x="16" y="16" width="213" height="310" rx="8" fill="hsl(${hue},60%,78%)"/>
    <rect x="30" y="50" width="185" height="150" rx="6" fill="hsl(${hue},45%,55%)"/>
    <text x="122" y="38" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#222">${text}</text></svg>`;
  const img = sharp(Buffer.from(svg));
  const buf = type === 'jpeg' ? await img.jpeg({ quality: 70 }).toBuffer() : await img.png().toBuffer();
  return `data:image/${type};base64,${buf.toString('base64')}`;
}

async function buildFixtures() {
  const crop = (hue, t) => art(hue, t, 'jpeg');
  const names = [
    ['Pikachu', 50], ['Raichu', 35], ['Eevee', 30], ['Charizard', 12], ['Blastoise', 210],
    ['Venusaur', 130], ['Mewtwo', 280], ['Gengar', 265], ['Snorlax', 190], ['Jigglypuff', 330],
    ['Dragonite', 28], ['Gyarados', 220], ['Alakazam', 45],
    ['Charmeleon', 20], ['Charmander', 8], ['Wartortle', 200], ['Squirtle', 195],
  ];
  const imgs = {};
  for (const [n, h] of names) imgs[n] = await art(h, n);
  const cand = (n, id, set, setCode, number) => ({ id, name: n, set, setCode, number, imageUrl: imgs[n] });
  const grid = (market, cond = market) => ({ source: 'pokemontcg', variants: { normal: { market, conditions: { NM: cond } } } });
  const grid2 = {
    source: 'pokemontcg',
    variants: {
      normal: { market: 2, conditions: { NM: 2 } },
      holofoil: { market: 9, conditions: { NM: 9 } },
      reverseHolofoil: { market: 4, conditions: { NM: 4 } },
    },
  };
  const box = [0, 0, 1, 1];

  const cards = [
    // 0-1: confirmed, one price each
    { identity: { id: 'base1-58', name: 'Pikachu', set: 'Base Set', setCode: 'base1', number: '58' }, confidence: 0.95, abstain: false,
      market_price: 5, price_grid: grid(5), box, crop: await crop(50, 'Pikachu'), why: { src: 'number', cos: 0.93 } },
    { identity: { id: 'base1-14', name: 'Raichu', set: 'Base Set', setCode: 'base1', number: '14' }, confidence: 0.92, abstain: false,
      market_price: 7.5, price_grid: grid(7.5), box, crop: await crop(35, 'Raichu'), why: { src: 'picture', cos: 0.88, lead: 0.05 } },
    // 2: confirmed, printing still open (range plus the "Which version is it?" strip)
    { identity: { id: 'base2-51', name: 'Eevee', set: 'Jungle', setCode: 'base2', number: '51' }, confidence: 0.9, abstain: false,
      setChoices: [cand('Eevee', 'base2-51', 'Jungle', 'base2', '51'), cand('Eevee', 'base2s-51', 'Jungle (Unlimited)', 'base2u', '51')],
      setRange: { low: 2, high: 9, count: 2, total: 2 },
      market_price: 4, price_grid: grid2, box, crop: await crop(30, 'Eevee') },
    // 3-4: choose cards with candidates; card 3 best match is worth $50 or more
    { identity: null, confidence: 0.4, abstain: true, box, crop: await crop(12, 'Charizard'),
      candidates: [
        cand('Charizard', 'base1-4', 'Base Set', 'base1', '4'), cand('Charizard', 'base2-6', 'Jungle', 'base2', '6'),
        cand('Charizard', 'xy12-11', 'Evolutions', 'xy12', '11'), cand('Charmeleon', 'base1-24', 'Base Set', 'base1', '24'),
        cand('Charmander', 'base1-46', 'Base Set', 'base1', '46'),
      ] },
    { identity: null, confidence: 0.35, abstain: true, box, crop: await crop(210, 'Blastoise'),
      candidates: [
        cand('Blastoise', 'base1-2', 'Base Set', 'base1', '2'), cand('Wartortle', 'base1-42', 'Base Set', 'base1', '42'),
        cand('Squirtle', 'base1-63', 'Base Set', 'base1', '63'),
      ] },
    // 5: not recognised: nothing close
    { identity: null, confidence: 0.1, abstain: true, candidates: [], box, crop: await crop(300, 'Unknown') },
    // 6: card back
    { identity: null, cardBack: true, confidence: 0, box, crop: await crop(220, 'Back') },
    // 7: skipped, 8: removed
    { skipped: true, identity: null, box, crop: await crop(130, 'Skipped') },
    { skipped: true, removed: true, identity: null, box, crop: await crop(280, 'Removed') },
    // 9: hidden, not a card
    { notCard: true, identity: null, box, crop: await crop(265, 'Not a card') },
  ];

  // Prices the popup asks for (priceCard) for each choose candidate.
  const prices = {
    'base1-4': 120, 'base2-6': 45, 'xy12-11': 30, 'base1-24': 8, 'base1-46': 6,
    'base1-2': 25, 'base1-42': 3, 'base1-63': 4,
  };
  const priced = {};
  for (const c of cards) {
    for (const cd of c.candidates || []) {
      if (prices[cd.id] != null) priced[cd.id] = { identity: { id: cd.id, name: cd.name, set: cd.set, setCode: cd.setCode, number: cd.number }, price_grid: grid(prices[cd.id]), market_price: prices[cd.id] };
    }
  }
  // A picked printing is priced the same way as a choose candidate.
  for (const cd of cards[2].setChoices) {
    priced[cd.id] = { identity: { id: cd.id, name: cd.name, set: cd.set, setCode: cd.setCode, number: cd.number }, price_grid: grid(cd.id === 'base2-51' ? 4 : 9), market_price: cd.id === 'base2-51' ? 4 : 9 };
  }
  // The final pricing screen: every card confirmed. Cards 3 and 4 were chosen from candidates (they keep them, so Change
  // reopens the Choose layout); the rest were identified on the scan and carry their page picture like any card.
  const sure = (n, id, set, setCode, number, hue, price, extra = {}) => ({
    identity: { id, name: n, set, setCode, number }, confidence: 0.94, abstain: false, market_price: price, price_grid: grid(price), box,
    ...extra,
  });
  const finalCards = [
    cards[0], cards[1],
    { ...cards[2], setChoices: [], setConfirmed: true, setRange: undefined, market_price: 4, price_grid: grid(4) },
    { ...cards[3], identity: { id: 'base1-4', name: 'Charizard', set: 'Base Set', setCode: 'base1', number: '4' }, confidence: 1, abstain: false, userConfirmed: true, setConfirmed: true, market_price: 120, price_grid: grid(120) },
    { ...cards[4], identity: { id: 'base1-2', name: 'Blastoise', set: 'Base Set', setCode: 'base1', number: '2' }, confidence: 1, abstain: false, userConfirmed: true, setConfirmed: true, market_price: 25, price_grid: grid(25) },
    sure('Venusaur', 'base1-15', 'Base Set', 'base1', '15', 130, 38, { crop: await crop(130, 'Venusaur') }),
    // $61.50 is high value: the user has confirmed it here, so the final screen reads "All cards priced" (9.8).
    sure('Mega Mewtwo ex Special Illustration Rare with a long name', 'me1-200', 'Mega Evolution Black Star Promos', 'me1', '200/191', 280, 61.5, { crop: await crop(280, 'Mewtwo'), userConfirmed: true }),
    sure('Gengar', 'base1-5', 'Base Set', 'base1', '5', 265, 14, { crop: await crop(265, 'Gengar') }),
    sure('Snorlax', 'base1-11', 'Base Set', 'base1', '11', 190, 9, { crop: await crop(190, 'Snorlax') }),
  ];
  // The same lot with that card not yet confirmed by the user: it carries "High value, double-check" and its Confirm check.
  const doubleCards = finalCards.map((c) => (c.userConfirmed && c.identity.id === 'me1-200' ? { ...c, userConfirmed: undefined } : c));
  return { cards, priced, final: { cards: finalCards, priced }, double: { cards: doubleCards, priced }, tiny: { crop: cards[0].crop } };
}

// ---------- browser helpers ----------

const hideWizard = (page) => page.evaluate(() => { document.getElementById('setup-overlay').style.display = 'none'; });

async function openPopup(ctx, extId, { width = 500, height = 760, scheme }) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  // The popup asks the background whether models are ready; give that answer time to land before hiding the wizard.
  await page.waitForTimeout(1200);
  return page;
}

async function popupWithScan(ctx, extId, fx, opts) {
  const page = await openPopup(ctx, extId, opts);
  await page.evaluate(({ cards, priced }) => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (msg) => {
      if (msg?.action === 'scanPage') return { cards, scanId: 'ui', srcWidth: 10, srcHeight: 10, pending: 0 };
      if (msg?.action === 'priceCard') return priced[msg.id] || { error: 'no fixture price' };
      if (msg?.action === 'highlightCard') return { ok: true };
      if (msg?.action === 'saveCorrection') return { ok: true };
      return real(msg);
    };
    const b = document.getElementById('btn-scan');
    b.disabled = false;
    b.click();
  }, { cards: fx.cards, priced: fx.priced });
  await page.waitForSelector('#results .card-row');
  // Best-match prices arrive after the rows; wait until no price cell still says it is loading.
  await page.waitForFunction(() => ![...document.querySelectorAll('#results .card-price')].some((e) => e.textContent.trim() === '…'), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  await hideWizard(page);
  return page;
}

async function scrollListToEnd(page) {
  await page.evaluate(() => {
    const last = [...document.querySelectorAll('#results .card-row')].pop();
    last?.scrollIntoView({ block: 'end' });
    let el = document.getElementById('results');
    while (el) { el.scrollTop = el.scrollHeight; el = el.parentElement; }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(250);
}

async function shoot(page, state, scheme, how, extra = {}) {
  await hideWizard(page).catch(() => {});
  const file = `${state}-${scheme}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: extra.fullPage === true });
  manifest.push({ state, scheme, file, reached: how, ...(extra.note ? { note: extra.note } : {}) });
  console.log(`  ${file} (${how})`);
}

// Runs one state on a fresh popup; a failure is recorded in the manifest and the run goes on.
async function state(name, scheme, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return; // ONLY=toast runs just the states with that prefix
  try { await fn(); } catch (err) {
    console.error(`  ${name}-${scheme} FAILED: ${err.message.split('\n')[0]}`);
    manifest.push({ state: name, scheme, file: null, reached: 'failed', note: err.message.split('\n')[0] });
  }
}

// ---------- main ----------

const fx = await buildFixtures();
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
});
try {
  const isExt = (w) => w.url().startsWith('chrome-extension://');
  const worker = ctx.serviceWorkers().find(isExt) || await ctx.waitForEvent('serviceworker', { predicate: isExt, timeout: 30000 });
  const extId = new URL(worker.url()).hostname;

  for (const scheme of SCHEMES) {
    console.log(`scheme ${scheme}`);

    // 1. Wizard steps: toggle what showWizStep toggles.
    const wizard = async (name, step, midDownload) => state(name, scheme, async () => {
      const page = await openPopup(ctx, extId, { scheme });
      await page.evaluate(({ step: s, mid }) => {
        const on = { 1: 'wiz-step-1', access: 'wiz-step-access', 2: 'wiz-step-2' }[s];
        for (const id of ['wiz-step-1', 'wiz-step-access', 'wiz-step-2']) document.getElementById(id).classList.toggle('active', id === on);
        document.getElementById('setup-overlay').style.display = 'flex';
        if (mid) {
          // The same DOM writes onSetupProgress makes: a status line and one bar per file.
          document.getElementById('setup-status').textContent = 'Downloading 2 of 3 · 42%';
          document.getElementById('setup-keep').hidden = false;
          document.getElementById('btn-setup').disabled = true;
          const bars = document.getElementById('setup-bars');
          bars.innerHTML = '';
          [['Detector', 100], ['Card model', 42], ['Card catalog', 0]].forEach(([n, pct], i) => {
            const bar = document.createElement('div');
            bar.id = `bar-${i}`;
            bar.className = 'setup-file';
            bar.innerHTML = `<span class="setup-file-name">${n}</span><div class="setup-file-track"><div class="setup-file-fill" id="fill-${i}" style="width:${pct}%"></div></div><span class="setup-file-pct" id="pct-${i}">${pct === 100 ? '✓' : pct + '%'}</span>`;
            bars.appendChild(bar);
          });
        }
      }, { step, mid: midDownload });
      await page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) });
      manifest.push({ state: name, scheme, file: `${name}-${scheme}.png`, reached: 'forced', note: midDownload ? 'download progress DOM written like onSetupProgress' : 'step classes toggled like showWizStep' });
      console.log(`  ${name}-${scheme}.png (forced)`);
      await page.close();
    });
    await wizard('wizard-1', 1, false);
    await wizard('wizard-1-downloading', 1, true);
    await wizard('wizard-access', 'access', false);
    await wizard('wizard-2', 2, false);

    // 1b. The download failed: Retry is the one button left (the DOM writes runSetupDownload makes on failure).
    await state('wizard-1-retry', scheme, async () => {
      const page = await openPopup(ctx, extId, { scheme });
      await page.evaluate(() => {
        for (const id of ['wiz-step-1', 'wiz-step-access', 'wiz-step-2']) document.getElementById(id).classList.toggle('active', id === 'wiz-step-1');
        document.getElementById('setup-overlay').style.display = 'flex';
        document.getElementById('setup-status').textContent = 'The download stopped. Check your connection and try again.';
        document.getElementById('btn-setup').hidden = true;
        document.getElementById('btn-setup-retry').hidden = false;
      });
      await page.screenshot({ path: path.join(OUT, `wizard-1-retry-${scheme}.png`) });
      manifest.push({ state: 'wizard-1-retry', scheme, file: `wizard-1-retry-${scheme}.png`, reached: 'forced', note: 'DOM written like a failed download' });
      console.log(`  wizard-1-retry-${scheme}.png (forced)`);
      await page.close();
    });

    // 1c. Scan Page cannot run: the line under the empty mark says why.
    await state('scan-disabled-reason', scheme, async () => {
      const page = await openPopup(ctx, extId, { scheme });
      await page.evaluate(() => {
        const why = document.getElementById('empty-why');
        why.textContent = 'Open a listing on Facebook Marketplace, Mercari or another site, then press Scan Page';
        why.hidden = false;
      });
      await shoot(page, 'scan-disabled-reason', scheme, 'forced', { note: 'the empty-why line written like showEmptyWhy for an unreadable tab' });
      await page.close();
    });

    // 2. Empty.
    await state('empty', scheme, async () => {
      const page = await openPopup(ctx, extId, { scheme });
      await shoot(page, 'empty', scheme, 'forced', { note: 'setup overlay hidden by style; nothing scanned' });
      await page.close();
    });

    // 3. Results, top.
    await state('results-top', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await shoot(page, 'results-top', scheme, 'natural', { note: 'fixture scan via stubbed scanPage; wizard hidden by style' });
      await page.close();
    });

    // 3b. The real window (500 x 640 inside), and the list scrolled so the first confirmed row is at the top.
    await state('results-top-real', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 640, scheme });
      await shoot(page, 'results-top-real', scheme, 'natural', { note: '500x640 viewport' });
      await page.close();
    });
    // 3c. Wide windows: the two-pane layout (720 px and up) and the grids (1100 px and up).
    for (const [name, width, height] of [['results-top-900', 900, 800], ['results-top-1440', 1440, 900], ['results-top-1920', 1920, 1040]]) {
      await state(name, scheme, async () => {
        const page = await popupWithScan(ctx, extId, fx, { width, height, scheme });
        const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        await shoot(page, name, scheme, 'natural', { note: `${width}x${height}; scrollWidth ${m.scrollWidth} clientWidth ${m.clientWidth}` });
        await page.close();
      });
    }

    // 3d. The toast: a plain message (Confirm on the first choose row) shown, then faded after 5 s.
    await state('toast', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 640, scheme });
      await page.locator('[data-confirm-best]').first().evaluate((b) => b.click());
      await page.waitForTimeout(600);
      console.log('  toast text:', await page.evaluate(() => document.getElementById('msg-bar').textContent));
      await shoot(page, 'toast', scheme, 'natural', { note: 'Confirm pressed on the first choose row; shot 600 ms after the message (the price-updated line replaces the confirmed line)' });
      await page.waitForTimeout(6000);
      await shoot(page, 'toast-faded', scheme, 'natural', { note: '6 s after the message: the toast has faded, the text is still in the element' });
      await page.close();
    });

    await state('results-confirmed', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 640, scheme });
      await page.evaluate(() => {
        const row = document.querySelector('#results .card-row:not(.choose-row):not(.unrec-row)');
        row?.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(250);
      await shoot(page, 'results-confirmed', scheme, 'natural', { note: 'first confirmed row scrolled to the top of the list; 500x640' });
      await page.close();
    });

    await state('results-printing', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 640, scheme });
      await page.evaluate(() => {
        document.querySelector('#results .pick-printing')?.closest('.card-row')?.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(250);
      await shoot(page, 'results-printing', scheme, 'natural', { note: 'the row with the version strip scrolled to the top; 500x640' });
      await page.close();
    });

    await state('results-printing-picked', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 640, scheme });
      const before = await page.evaluate(() => {
        const row = document.querySelector('#results .pick-printing')?.closest('.card-row');
        return { idx: row?.dataset.idx, price: row?.querySelector('.card-price')?.textContent.trim(), cls: row?.className };
      });
      await page.locator('#results .pick-printing').first().evaluate((l) => l.closest('.card-row').querySelector('[data-strip-pick]').click());
      await page.waitForTimeout(800);
      // The pick settles the row, so it collapses to one line (12); open it to show the "Picked: ..." strip.
      await page.locator(`#results .card-row.is-collapsed[data-idx="${before.idx}"] .row-toggle`).evaluate((b) => b.click());
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#results .card-row')].find((r) => r.querySelector('.set-select-row'));
        row?.scrollIntoView({ block: 'start' });
        return { price: row?.querySelector('.card-price')?.textContent.trim(), cls: row?.className, label: row?.querySelector('.set-select-row .lbl')?.textContent.trim() };
      });
      await page.waitForTimeout(250);
      await shoot(page, 'results-printing-picked', scheme, 'natural', { note: `first tile clicked; before ${JSON.stringify(before)} after ${JSON.stringify(after)}` });
      await page.close();
    });

    // 4. Results, bottom with the groups expanded by their toggles.
    await state('results-bottom', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      for (const sel of ['[data-unrec-toggle]', '[data-skipped-toggle]', '[data-notcard-toggle]']) {
        const t = page.locator(sel);
        if (await t.count()) await t.first().evaluate((b) => b.click());
      }
      await scrollListToEnd(page);
      await shoot(page, 'results-bottom', scheme, 'natural', { note: 'groups expanded by clicking their toggles' });
      await page.close();
    });

    // 5. Choose search panel.
    await state('choose-search', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.locator('.choose-row [data-open-search]').first().evaluate((b) => b.click());
      await page.waitForSelector('.picker-input');
      await shoot(page, 'choose-search', scheme, 'natural');
      await page.close();
    });

    // 6. Wrong card?
    await state('wrong-card', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.locator('.card-row[data-idx="0"] .row-toggle').evaluate((b) => b.click()); // a settled row is one line until opened (12)
      await page.locator('.card-row[data-idx="0"] [data-open-search][data-via="wrong-card"]').evaluate((b) => b.click());
      await page.waitForSelector('.picker-input');
      await shoot(page, 'wrong-card', scheme, 'natural');
      await page.close();
    });

    // 6b. Round 3: the final pricing screen (everything confirmed) at three widths, the reopened choice, and a mixed lot at 2505 px.
    for (const [name, width, height] of [['final-priced-500', 500, 760], ['final-priced-1440', 1440, 900], ['final-priced-2505', 2505, 1272]]) {
      await state(name, scheme, async () => {
        const page = await popupWithScan(ctx, extId, fx.final, { width, height, scheme });
        const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, done: document.querySelector('.lt-done')?.textContent.trim(), head: document.querySelector('.priced-head')?.textContent.trim() }));
        if (m.done !== 'All cards priced' || !m.head) throw new Error(`final screen missing: ${JSON.stringify(m)}`);
        await shoot(page, name, scheme, 'natural', { note: `${width}x${height}; overflow ${m.over}px; "${m.head}", "${m.done}"` });
        await page.close();
      });
    }
    // 6b2. High value: the flagged row's check (crop beside the matched card, Confirm, Change) and "1 to double-check" in the lot card.
    for (const [name, width, height] of [['double-check-500', 500, 900], ['double-check-1440', 1440, 900]]) {
      await state(name, scheme, async () => {
        const page = await popupWithScan(ctx, extId, fx.double, { width, height, scheme });
        const m = await page.evaluate(() => ({
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          left: document.querySelector('.lt-check')?.textContent.trim(),
          confirm: document.querySelector('.double-check [data-confirm-match]')?.getAttribute('aria-label'),
          pics: document.querySelectorAll('.double-check .scanned-card img, .double-check .pick-match img, .double-check .pick-match .art-missing').length,
        }));
        if (m.left !== '1 to double-check' || !m.confirm || m.pics !== 2) throw new Error(`double-check row missing: ${JSON.stringify(m)}`);
        await page.evaluate(() => document.querySelector('.double-check').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(250);
        await shoot(page, name, scheme, 'natural', { note: `${width}x${height}; overflow ${m.over}px; "${m.left}"; ${m.confirm}` });
        await page.close();
      });
    }
    // 6b3. Section 12: confirmed rows are one line; one row opened. The stock picture is the row's crop here (fixture cards carry no art URL).
    for (const [width, height] of [[500, 900], [1440, 900]]) {
      const lot = { ...fx.final, cards: fx.final.cards.map((c) => (c.crop && c.identity ? { ...c, identity: { ...c.identity, imageUrl: c.crop } } : c)) };
      await state(`collapse-list-${width}`, scheme, async () => {
        const page = await popupWithScan(ctx, extId, lot, { width, height, scheme });
        const m = await page.evaluate(() => ({ rows: document.querySelectorAll('.card-row.is-collapsed').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
        if (!m.rows) throw new Error('no collapsed row rendered');
        await shoot(page, `collapse-list-${width}`, scheme, 'natural', { note: `${width}x${height}; ${m.rows} collapsed rows; overflow ${m.over}px` });
        await page.close();
      });
      await state(`collapse-open-${width}`, scheme, async () => {
        const page = await popupWithScan(ctx, extId, lot, { width, height, scheme });
        await page.locator('.card-row[data-idx="1"] .row-toggle').click();
        await page.waitForSelector('.card-row.is-open');
        await page.evaluate(() => document.querySelector('.card-row.is-open').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(250);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await shoot(page, `collapse-open-${width}`, scheme, 'natural', { note: `${width}x${height}; the Raichu row opened by its toggle; overflow ${over}px` });
        await page.close();
      });
    }
    await state('change-open', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx.final, { width: 500, height: 900, scheme });
      await page.locator('.card-row[data-idx="3"] .row-toggle').evaluate((b) => b.click()); // a settled row is one line until opened (12)
      await page.locator('.card-row[data-idx="3"] [data-via="wrong-card"]').evaluate((b) => b.click());
      await page.waitForSelector('.card-row.changing');
      await page.evaluate(() => document.querySelector('.card-row.changing').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(250);
      await shoot(page, 'change-open', scheme, 'natural', { note: 'Change on a priced card that has candidates: Choose layout in place' });
      await page.close();
    });
    // 6c. The compare dock (two-pane) and the fixed preview (narrow): hover a candidate tile of the second choose row.
    for (const [name, width, height] of [['dock-compare-1440', 1440, 900], ['dock-compare-2505', 2505, 1272], ['narrow-compare', 500, 760]]) {
      await state(name, scheme, async () => {
        const page = await popupWithScan(ctx, extId, fx, { width, height, scheme });
        const tile = page.locator('.choose-row').nth(1).locator('.pick-choice').nth(1);
        await tile.scrollIntoViewIfNeeded();
        await tile.hover();
        await page.waitForSelector('#loupe:not([hidden])');
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => { const r = document.getElementById('loupe').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), panels: document.querySelectorAll('#loupe .loupe-panel').length, dock: !document.getElementById('compare-dock').hidden && getComputedStyle(document.getElementById('compare-dock')).display !== 'none', toastTop: Math.round(document.getElementById('msg-bar').getBoundingClientRect().top), toastShown: !document.getElementById('msg-bar').classList.contains('hidden') && !document.getElementById('msg-bar').classList.contains('fading'), dockBottom: Math.round(document.getElementById('dock-img').getBoundingClientRect().bottom) }; });
        if (m.dock && m.toastShown && m.dockBottom > m.toastTop) throw new Error(`toast covers the dock image: image bottom ${m.dockBottom} > toast top ${m.toastTop}`);
        await shoot(page, name, scheme, 'natural', { note: `${width}x${height}; preview at ${m.left},${m.top} with ${m.panels} panel(s); dock ${m.dock ? 'shown' : 'none'}` });
        await page.close();
      });
    }
    await state('mixed-2505', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 2505, height: 1272, scheme });
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await shoot(page, 'mixed-2505', scheme, 'natural', { note: `mixed lot (to confirm, pick printing, priced, skipped); overflow ${over}px` });
      await page.close();
    });

    // 7. Why this card?
    await state('why-open', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.locator('.card-row[data-idx="0"] .row-toggle').evaluate((b) => b.click()); // a settled row is one line until opened (12)
      const why = page.locator('[data-why]');
      if (!(await why.count())) throw new Error('no [data-why] button rendered');
      await why.first().evaluate((b) => b.click());
      await page.waitForSelector('.why-pop');
      await shoot(page, 'why-open', scheme, 'natural');
      await page.close();
    });

    // 7b. Hover preview (loupe) and the tile lift. Each hovers through the real pointer and waits past the 150 ms delay.
    const hoverShot = async (name, opts, hover, note, wait = 450) => state(name, scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme, ...opts });
      await hover(page);
      await page.waitForTimeout(wait);
      const r = await page.evaluate(() => {
        const el = document.getElementById('loupe');
        const b = el.getBoundingClientRect();
        return { open: !el.hidden, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), vw: window.innerWidth, vh: window.innerHeight, imgs: el.querySelectorAll('img').length };
      });
      await shoot(page, name, scheme, 'natural', { note: `${note}; loupe ${JSON.stringify(r)}` });
      await page.close();
    });
    // Scroll the picture to the middle first and let the smooth scroll end: a scroll closes the loupe by design.
    const hoverIn = async (page, sel, nth = 0) => {
      const el = page.locator(sel).nth(nth);
      await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(500);
      await el.hover();
    };
    const secondCandidate = (page) => hoverIn(page, '#results .choose-row .pick-card', 1);
    await hoverShot('loupe-compare', { width: 500, height: 680 }, secondCandidate, '500x680, second candidate of the first choose row');
    if (scheme === 'light') {
      await hoverShot('loupe-printing', { width: 500, height: 640 }, async (page) => {
        await page.evaluate(() => document.querySelector('#results .pick-printing')?.closest('.card-row')?.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(250);
        await page.locator('#results .pick-printing').first().locator('xpath=ancestor::*[contains(@class,"card-row")]').locator('.strip-tile').nth(1).hover();
      }, '500x640, second printing tile');
      await hoverShot('loupe-crop', { width: 500, height: 680 }, (page) => hoverIn(page, '#results .choose-row .scanned-card'), '500x680, the crop');
      await hoverShot('loupe-bulk', { width: 500, height: 760 }, async (page) => {
        await page.locator('[data-review-all]').first().evaluate((b) => b.click());
        await page.waitForSelector('#bulk-panel:not([hidden])');
        await page.waitForTimeout(300);
        await page.locator('#bulk-list .bulk-img').nth(1).hover();
      }, 'review dialog, the candidate image of the first pair');
      await hoverShot('hover-tile', { width: 500, height: 680 }, secondCandidate, '500x680, candidate hovered, shot 120 ms after the pointer arrives (before the 150 ms preview delay) to see the lift and sheen', 120);
    }
    if (scheme === 'dark') {
      await hoverShot('loupe-1440', { width: 1440, height: 900 }, secondCandidate, '1440x900, second candidate of the first choose row');
    }

    // 8. Bulk review dialog.
    await state('bulk-dialog', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.locator('[data-review-all]').first().evaluate((b) => b.click());
      await page.waitForSelector('#bulk-panel:not([hidden])');
      await page.waitForTimeout(300);
      await shoot(page, 'bulk-dialog', scheme, 'natural');
      await page.close();
    });

    // 9. Notices, all at once.
    await state('notices', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.evaluate(() => {
        document.getElementById('access-text').textContent = 'Let Sweep read the original photos on example.com? It finds more cards.';
        document.getElementById('access-notice').hidden = false;
        document.getElementById('fullsize-text').textContent = 'Some cards are small. Open the full-size photo to read them better.';
        document.getElementById('fullsize-notice').hidden = false;
        document.getElementById('restore-text').textContent = 'Restored your last scan (12 min ago).';
        document.getElementById('restore-note').hidden = false;
        const bar = document.getElementById('msg-bar');
        bar.textContent = 'Reload Sweep at chrome://extensions, then press Scan Page.';
        bar.classList.add('error');
        bar.classList.remove('hidden');
        bar.setAttribute('role', 'alert');
      });
      await shoot(page, 'notices', scheme, 'forced', { note: 'hidden removed on the three notices (the page shows one at a time, access first; this shot lays all three out to check each); msg-bar error text is the explainScanError reload message' });
      await page.close();
    });

    // 9b. One notice at a time: the access question alone, as the popup shows it.
    await state('notice-access-only', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.evaluate(() => {
        document.getElementById('access-text').textContent = 'Let Sweep read the original photos on example.com? It finds more cards.';
        document.getElementById('access-notice').hidden = false;
      });
      await shoot(page, 'notice-access-only', scheme, 'forced', { note: 'only the access notice visible, as nextNotice would leave it' });
      await page.close();
    });

    // 10. Scanning button.
    await state('scanning', scheme, async () => {
      const page = await openPopup(ctx, extId, { scheme });
      await page.evaluate(() => {
        const b = document.getElementById('btn-scan');
        b.classList.add('scanning');
        document.getElementById('btn-label').textContent = 'SCANNING…';
        b.disabled = true;
        b.setAttribute('aria-busy', 'true');
        document.getElementById('era-select').disabled = true;
        // The line that stays while a scan runs (showScanStatus): "Reading 6 cards…" once boxes are found.
        const status = document.getElementById('scan-status');
        status.textContent = 'Reading 6 cards…';
        status.hidden = false;
      });
      await page.waitForTimeout(500);
      console.log('  scan button opacity:', await page.evaluate(() => getComputedStyle(document.getElementById('btn-scan')).opacity));
      await shoot(page, 'scanning', scheme, 'forced', { note: 'DOM set like beginScanUi' });
      await page.close();
    });

    // 10b. A rescan with a lot shown: the same status line, under the Scan button row.
    await state('scanning-with-lot', scheme, async () => {
      const page = await popupWithScan(ctx, extId, fx, { scheme });
      await page.evaluate(() => {
        const b = document.getElementById('btn-scan');
        b.classList.add('scanning');
        document.getElementById('btn-label').textContent = 'SCANNING…';
        b.disabled = true;
        const status = document.getElementById('scan-status');
        status.textContent = 'Reading 6 cards…';
        status.hidden = false;
      });
      await shoot(page, 'scanning-with-lot', scheme, 'forced', { note: 'DOM set like beginScanUi on a popup that already shows a lot' });
      await page.close();
    });

    // 11. Options page.
    await state('options', scheme, async () => {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 900, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`chrome-extension://${extId}/options.html`);
      await page.waitForTimeout(800);
      await shoot(page, 'options', scheme, 'natural', { fullPage: true });
      await page.close();
    });
  }

  // Extra: narrow options page, light only.
  await state('options-narrow', 'light', async () => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 480, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.waitForTimeout(800);
    await shoot(page, 'options-narrow', 'light', 'natural', { fullPage: true, note: '480x900' });
    await page.close();
  });

  // Extra: narrow popup, light only.
  await state('results-top-narrow', 'light', async () => {
    const page = await popupWithScan(ctx, extId, fx, { width: 420, height: 640, scheme: 'light' });
    await shoot(page, 'results-top-narrow', 'light', 'natural');
    await page.close();
  });
  // Card size slider at its two ends, through the real control.
  for (const [name, value] of [['results-top-size-small', '0.8'], ['results-top-size-large', '1.6']]) {
    await state(name, 'light', async () => {
      const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 680, scheme: 'light' });
      await page.locator('#card-size').fill(value);
      await page.waitForTimeout(300);
      const scale = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--card-scale'));
      await shoot(page, name, 'light', 'natural', { note: `500x680; slider filled with ${value}; --card-scale ${scale.trim()}` });
      await page.locator('#card-size').fill('1'); // the size is saved in the browser profile: put it back for the states after this one
      await page.waitForTimeout(200);
      await page.close();
    });
  }
  // 360 x 640, light only: the action bar must wrap to two rows without a horizontal scroll.
  await state('results-top-360', 'light', async () => {
    const page = await popupWithScan(ctx, extId, fx, { width: 360, height: 640, scheme: 'light' });
    const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    const ok = m.scrollWidth <= m.clientWidth + 1;
    console.log(`  360 scrollWidth ${m.scrollWidth} clientWidth ${m.clientWidth} ${ok ? 'ok' : 'HORIZONTAL SCROLL'}`);
    const inner = await page.evaluate(() => {
      const sc = document.querySelector('main.scroll');
      const wide = [...sc.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > sc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
      const scrollers = [...document.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}#${el.id}`);
      const pc = document.querySelector('.pick-card'); const pr = document.querySelector('.pick-row');
      const rr = (e) => e ? `${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}` : '-';
      return { scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth, wide: [...wide, ...scrollers, `pickrow ${rr(pr)} pickcard ${rr(pc)} cols ${pr && getComputedStyle(pr).gridTemplateColumns}`] };
    });
    console.log(`  360 main.scroll scrollWidth ${inner.scrollWidth} clientWidth ${inner.clientWidth} ${inner.wide.join(' ')}`);
    await shoot(page, 'results-top-360', 'light', 'natural', { note: `360x640; scrollWidth ${m.scrollWidth} clientWidth ${m.clientWidth} noHorizontalScroll=${ok}` });
    await page.close();
  });

  // Forced colors, light only: the same states, with the page's forced-colors media query active.
  const fcScan = (name, after) => state(name, 'light', async () => {
    const page = await popupWithScan(ctx, extId, fx, { width: 500, height: 640, scheme: 'light' });
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
    await page.waitForTimeout(500); // let transitions (switch, tiles) settle under the new colors
    await after(page);
    await shoot(page, name, 'light', 'natural', { note: 'forcedColors active' });
    await page.close();
  });
  await fcScan('fc-results-top', async () => {});
  await fcScan('fc-results-confirmed', async (p) => {
    await p.evaluate(() => document.querySelector('#results .card-row:not(.choose-row):not(.unrec-row)')?.scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(250);
  });
  await fcScan('fc-results-printing', async (p) => {
    await p.evaluate(() => document.querySelector('#results .pick-printing')?.closest('.card-row')?.scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(250);
  });
  await fcScan('fc-results-printing-picked', async (p) => {
    const idx = await p.locator('#results .pick-printing').first().evaluate((l) => l.closest('.card-row').dataset.idx);
    await p.locator('#results .pick-printing').first().evaluate((l) => l.closest('.card-row').querySelector('[data-strip-pick]').click());
    await p.waitForTimeout(800);
    await p.locator(`#results .card-row.is-collapsed[data-idx="${idx}"] .row-toggle`).evaluate((b) => b.click()); // the pick collapsed the row (12)
    await p.waitForTimeout(250);
    await p.evaluate(() => [...document.querySelectorAll('#results .card-row')].find((r) => r.querySelector('.set-select-row'))?.scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(250);
  });
  await fcScan('fc-bulk-dialog', async (p) => {
    await p.locator('[data-review-all]').first().evaluate((b) => b.click());
    await p.waitForSelector('#bulk-panel:not([hidden])');
    await p.waitForTimeout(300);
  });
  await fcScan('fc-notices', async (p) => {
    await p.evaluate(() => {
      document.getElementById('access-text').textContent = 'Let Sweep read the original photos on example.com? It finds more cards.';
      document.getElementById('access-notice').hidden = false;
      document.getElementById('fullsize-text').textContent = 'Some cards are small. Open the full-size photo to read them better.';
      document.getElementById('fullsize-notice').hidden = false;
      document.getElementById('restore-text').textContent = 'Restored your last scan (12 min ago).';
      document.getElementById('restore-note').hidden = false;
      const bar = document.getElementById('msg-bar');
      bar.textContent = 'Reload Sweep at chrome://extensions, then press Scan Page.';
      bar.classList.add('error');
      bar.classList.remove('hidden');
      bar.setAttribute('role', 'alert');
    });
  });
  await state('fc-wizard-1', 'light', async () => {
    const page = await openPopup(ctx, extId, { scheme: 'light' });
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
    await page.evaluate(() => {
      for (const id of ['wiz-step-1', 'wiz-step-access', 'wiz-step-2']) document.getElementById(id).classList.toggle('active', id === 'wiz-step-1');
      document.getElementById('setup-overlay').style.display = 'flex';
    });
    await page.screenshot({ path: path.join(OUT, 'fc-wizard-1-light.png') });
    manifest.push({ state: 'fc-wizard-1', scheme: 'light', file: 'fc-wizard-1-light.png', reached: 'forced', note: 'forcedColors active; step classes toggled like showWizStep' });
    console.log('  fc-wizard-1-light.png (forced)');
    await page.close();
  });
  await state('fc-options', 'light', async () => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 900, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
    await page.goto(`chrome-extension://${extId}/options.html`);
    await page.waitForTimeout(800);
    await shoot(page, 'fc-options', 'light', 'natural', { fullPage: true, note: 'forcedColors active' });
    await page.close();
  });
} finally {
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ label, extension: 'dist/extension-wasm', states: manifest }, null, 2));
const written = manifest.filter((m) => m.file).length;
console.log(`wrote ${written} PNGs and manifest.json to ${OUT}`);
if (manifest.some((m) => !m.file)) process.exitCode = 1;
