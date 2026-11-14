/* global chrome, createImageBitmap, Blob, atob -- used inside page.evaluate, which runs in the browser */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// D14a (gate 2, S2): the art-stamp OCR on a real Dragon Frontiers reverse holo (Pinsir δ 9/101, eBay 377359285324).
// The photo is a marketplace photo, so it is never committed: it lives in the gitignored data/fixtures-local/stamps/.
// The check needs a browser (onnxruntime-web, OffscreenCanvas) and the OCR models from the public release, so it runs
// only on request: LOCAL_STAMP_OCR=1 with the photo present. Otherwise it is skipped.
// Today PP-OCRv4 reads the outlined logo as "DOTIGRS" / "168S", never FRONTIERS: a known limit, kept as a todo.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO = path.join(root, 'data', 'fixtures-local', 'stamps', 's2-pinsir-df-ebay-377359285324.webp');
// The detector box of the scan (stand included) and the card itself, in the 1011x1185 photo.
const BOXES = { detector: [6, 19, 926, 1170], card: [168, 84, 859, 1023] };
const OCR_RELEASE = 'https://github.com/fabcrowd/pokemon-auto-lister/releases/download/v2.2/';
const skip = !fs.existsSync(PHOTO) ? 'local photo absent' : process.env.LOCAL_STAMP_OCR !== '1' ? 'set LOCAL_STAMP_OCR=1 to run' : false;

async function readStamps() {
  const { chromium } = await import('@playwright/test');
  const ext = path.join(root, 'dist', 'extension-wasm');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
  });
  try {
    let worker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
    if (!worker) worker = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith('chrome-extension://'), timeout: 15000 });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    return await page.evaluate(async ({ image, boxes, release }) => {
      const ort = await import(chrome.runtime.getURL('vendor/ort.wasm.min.js'));
      globalThis.ort = ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
      const [det, rec] = await Promise.all(['ocr_det.onnx', 'ocr_rec.onnx'].map(async (n) => new Uint8Array(await (await fetch(release + n)).arrayBuffer())));
      const ocr = await import(chrome.runtime.getURL('lib/ocr.js'));
      const { rectifyCard } = await import(chrome.runtime.getURL('lib/rectify.js'));
      const variant = await import(chrome.runtime.getURL('lib/variant.js'));
      await ocr.loadNumberReader(det, rec);
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image), (c) => c.charCodeAt(0))]));
      const out = {};
      for (const [name, box] of Object.entries(boxes)) {
        const text = await ocr.readArtStamp(rectifyCard(bitmap, box));
        out[name] = { text, set: variant.stampSetCode(text) };
      }
      return out;
    }, { image: fs.readFileSync(PHOTO).toString('base64'), boxes: BOXES, release: OCR_RELEASE });
  } finally {
    await context.close();
  }
}

test('D14a: the Dragon Frontiers logo on the S2 Pinsir δ is read as ex15', { skip, todo: 'PP-OCRv4 cannot read the outlined DF logo' }, async () => {
  const reads = await readStamps();
  for (const [name, read] of Object.entries(reads)) assert.equal(read.set, 'ex15', `${name}: read "${read.text}"`);
});
