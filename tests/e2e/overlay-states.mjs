/**
 * Screenshots of the page overlay (content.js) over a synthetic binder-page photo: a 3x3 grid, and a 5x5 grid of small
 * cards. Fixture data only: the photos are SVGs drawn here (plain coloured card shapes with a fake name bar), nothing from
 * data/ and no marketplace photo.
 *
 * Run: node tests/e2e/overlay-states.mjs <label> [--script=<path to a content.js>]
 * Output: .tmp/overlay-shots/<label>/<state>.png and manifest.json.
 *
 * It loads content.js into a plain local page with a stub `chrome.runtime`, so no extension build is needed. By default
 * it runs tools/extension-wasm/content.js. For a "before" run against an older copy, pass --script (for example the dev
 * build in dist/extension-wasm/content.js, which is a generated file this script only loads, never edits).
 * The states: resting; hovering a middle card; hovering a card in the top row (the name card goes below, inside the
 * photo); the popup's highlight; and, on the 5x5 grid of ~70 px cards, resting and hovering (dots appear there).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const label = process.argv[2];
if (!label || !/^[\w.-]+$/.test(label)) {
  console.error('usage: node tests/e2e/overlay-states.mjs <label> [--script=<path>]');
  process.exit(2);
}
const scriptArg = process.argv.find((a) => a.startsWith('--script='));
const SCRIPT = path.resolve(ROOT, scriptArg ? scriptArg.slice('--script='.length) : 'tools/extension-wasm/content.js');
const OUT = path.join(ROOT, '.tmp', 'overlay-shots', label);
fs.mkdirSync(OUT, { recursive: true });

const SCALE = 2;
const PHOTO_AT = { x: 80, y: 40 };

// ---------- fixtures ----------

/** A binder page as an SVG: cols x rows card shapes in pockets, each with a fake name bar at the top. */
function binderPhoto(cols, rows, cw, ch, gap) {
  const w = cols * cw + (cols + 1) * gap;
  const h = rows * ch + (rows + 1) * gap;
  const cells = [];
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = gap + c * (cw + gap);
      const y = gap + r * (ch + gap);
      const hue = (i * 47 + 20) % 360;
      const pad = Math.max(3, cw * 0.05);
      cells.push(`
        <rect x="${x - 3}" y="${y - 3}" width="${cw + 6}" height="${ch + 6}" rx="6" fill="#1f2029" stroke="#3a3b48"/>
        <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${cw * 0.05}" fill="hsl(${hue},55%,45%)"/>
        <rect x="${x + pad}" y="${y + pad}" width="${cw - 2 * pad}" height="${ch * 0.11}" rx="3" fill="hsl(${hue},60%,86%)"/>
        <rect x="${x + pad * 2}" y="${y + pad + ch * 0.035}" width="${cw * 0.45}" height="${Math.max(3, ch * 0.035)}" rx="1.5" fill="hsl(${hue},40%,25%)"/>
        <rect x="${x + pad}" y="${y + ch * 0.2}" width="${cw - 2 * pad}" height="${ch * 0.48}" rx="4" fill="hsl(${hue},45%,62%)"/>
        <rect x="${x + pad}" y="${y + ch * 0.72}" width="${cw - 2 * pad}" height="${ch * 0.17}" rx="3" fill="hsl(${hue},50%,82%)"/>
        <rect x="${x + pad}" y="${y + ch * 0.92}" width="${cw * 0.22}" height="${Math.max(3, ch * 0.03)}" rx="1.5" fill="hsl(${hue},40%,25%)"/>
        <rect x="${x + cw - pad - cw * 0.3}" y="${y + ch * 0.92}" width="${cw * 0.3}" height="${Math.max(3, ch * 0.03)}" rx="1.5" fill="hsl(${hue},40%,25%)"/>`);
      boxes.push([x, y, x + cw, y + ch]);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#2b2c36"/>${cells.join('')}</svg>`;
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, w, h, boxes };
}

const NAMES = ['Pikachu', 'Charizard ex', 'Team Rocket\'s Moltres ex', 'Blastoise', 'Mewtwo', 'Gengar', 'Snorlax', 'Dark Slowbro', 'Eevee'];

// One card per state the overlay has, in the order the 3x3 grid shows them.
function stateCard(kind, i) {
  const name = NAMES[i % NAMES.length];
  const identity = { name, number: String(10 + i), set: 'Fixture Set', setCode: 'fx' };
  switch (kind) {
    case 'identified': return { identity, display: { state: 'identified', number: identity.number, price: 3.49 } };
    case 'printing': return { identity, display: { state: 'printing', number: identity.number, printingNote: 'set not sure · $0.60–$12.01' } };
    case 'choose-guess': return { identity: null, abstain: true, display: { state: 'choose', guess: { name: `${name}`, price: 0.74 } } };
    case 'choose-none': return { identity: null, abstain: true, display: { state: 'choose' } };
    case 'high': return { identity, display: { state: 'identified', number: identity.number, price: 120, highValue: true } };
    case 'none': return { identity: null, abstain: true, cardBack: true, display: { state: 'none' } };
    case 'skipped': return { identity, display: { state: 'skipped' } };
    default: throw new Error(kind);
  }
}
const KINDS_3X3 = ['identified', 'printing', 'choose-guess', 'choose-none', 'high', 'none', 'skipped', 'choose-guess', 'identified'];
const KINDS_5X5 = ['identified', 'printing', 'choose-guess', 'choose-none', 'high', 'none', 'skipped'];

function pageHtml(photo, at) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#d4d7de}
    #photo{position:absolute;left:${at.x}px;top:${at.y}px;width:${photo.w}px;height:${photo.h}px}
  </style></head><body><img id="photo" alt="Binder page" src="${photo.src}"></body></html>`;
}

// content.js talks to the extension only through chrome.runtime; this stub hands its message listener to the test.
// `withStorage`: also stub chrome.storage.local with an empty store, so the first-scan legend (shown once) appears.
const STUB_CHROME = (withStorage) => {
  const onMessage = {
    addListener(fn) {
      window.__send = (msg) => new Promise((resolve) => {
        const async = fn(msg, null, resolve);
        if (async !== true) resolve(undefined);
      });
    },
  };
  const store = {};
  const storage = withStorage ? { local: { get: async (key) => ({ [key]: store[key] }), set: async (values) => { Object.assign(store, values); } } } : undefined;
  window.chrome = { runtime: { onMessage, sendMessage: () => Promise.resolve() }, storage };
};

const manifest = [];

async function scenario(browser, name, { cols, rows, cw, ch, gap, kinds, viewport, legend = false, at = PHOTO_AT }) {
  const photo = binderPhoto(cols, rows, cw, ch, gap);
  const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.setContent(pageHtml(photo, at));
  await page.evaluate(STUB_CHROME, legend);
  await page.waitForFunction(() => document.getElementById('photo').complete);
  await page.addScriptTag({ path: SCRIPT });
  const cards = photo.boxes.map((rel, i) => ({
    box: [rel[0] + at.x, rel[1] + at.y, rel[2] + at.x, rel[3] + at.y],
    ...stateCard(kinds[i % kinds.length], i),
  }));
  await page.evaluate(() => window.__send({ action: 'findCards' }));
  await page.evaluate(({ cards: list, w, h }) => window.__send({ action: 'showOverlay', cards: list, srcWidth: w, srcHeight: h }), { cards, w: viewport.width, h: viewport.height });

  const shoot = async (state, { hover = null, highlight = null } = {}) => {
    await page.evaluate((index) => window.__send({ action: 'highlightCard', index }), highlight);
    if (hover == null) await page.mouse.move(1, 1);
    else {
      const b = cards[hover].box;
      await page.mouse.move((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    }
    await page.waitForTimeout(150);
    const file = `${name}-${state}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    manifest.push({ file, grid: name, state, hover, highlight, script: path.relative(ROOT, SCRIPT) });
  };
  return { shoot, close: () => context.close(), cards, cols };
}

const browser = await chromium.launch({ headless: true });
try {
  const g3 = await scenario(browser, '3x3', { cols: 3, rows: 3, cw: 190, ch: 266, gap: 16, kinds: KINDS_3X3, viewport: { width: 800, height: 960 } });
  await g3.shoot('rest');
  await g3.shoot('hover-middle', { hover: 4 });
  await g3.shoot('hover-top-row', { hover: 1 });
  await g3.shoot('hover-choose', { hover: 2 });
  await g3.shoot('highlight', { highlight: 5 });
  await g3.close();

  // The first scan: the legend pill above the photo (shown once, then remembered in chrome.storage.local).
  // Photo at the top of a short window: no room above or below, so the legend sits inside and closes itself (shot at rest, then on hover).
  const legend = await scenario(browser, '3x3-legend-inside', { cols: 3, rows: 3, cw: 190, ch: 266, gap: 16, kinds: KINDS_3X3, viewport: { width: 800, height: 960 }, legend: true });
  await legend.shoot('first-scan');
  await legend.shoot('first-scan-hover', { hover: 4 });
  await legend.close();
  // Room above the photo: the legend sits above its top edge, outside the cards.
  const legendAbove = await scenario(browser, '3x3-legend-above', { cols: 3, rows: 3, cw: 190, ch: 266, gap: 16, kinds: KINDS_3X3, viewport: { width: 800, height: 1000 }, legend: true, at: { x: 80, y: 110 } });
  await legendAbove.shoot('first-scan');
  await legendAbove.close();
  // No room above, room below: the legend sits under the photo.
  const legendBelow = await scenario(browser, '3x3-legend-below', { cols: 3, rows: 3, cw: 190, ch: 266, gap: 16, kinds: KINDS_3X3, viewport: { width: 800, height: 1000 }, legend: true, at: { x: 80, y: 30 } });
  await legendBelow.shoot('first-scan');
  await legendBelow.close();
  const legendNarrow = await scenario(browser, '3x3-legend-narrow', { cols: 3, rows: 3, cw: 190, ch: 266, gap: 16, kinds: KINDS_3X3, viewport: { width: 640, height: 1000 }, legend: true, at: { x: 40, y: 110 } });
  await legendNarrow.shoot('first-scan');
  await legendNarrow.close();

  const g5 = await scenario(browser, '5x5', { cols: 5, rows: 5, cw: 70, ch: 98, gap: 8, kinds: KINDS_5X5, viewport: { width: 800, height: 640 } });
  await g5.shoot('rest');
  await g5.shoot('hover-middle', { hover: 12 });
  await g5.shoot('hover-top-row', { hover: 2 });
  await g5.close();
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const m of manifest) console.log(path.join(OUT, m.file));
