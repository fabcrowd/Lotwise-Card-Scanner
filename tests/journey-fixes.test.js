// Section 11 (slice B) of docs/plans/extension-ui-redesign.md: the words and counts of the confirm, version, export and header steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotCounts, printingNote, scanSummary } from '../tools/extension-wasm/lib/card-display.js';
import { chooseHeading, pickPrintingHeading, reviewLabel, skippedHeading, SKIP_LABEL, renderSkippedRow } from '../tools/extension-wasm/lib/choose-flow.js';
import { lotExportLabels, lotExportRows } from '../tools/extension-wasm/lib/lot-export.js';
import { notCardHeading } from '../tools/extension-wasm/lib/not-card.js';
import { unrecognisedLabel } from '../tools/extension-wasm/lib/card-picker.js';
import {
  CHOOSE_VERSION_LABEL, CLEARED_TOAST, EDITION_LABEL, HIGH_VALUE_TEXT, NO_PRICE_FOR_VERSION, PAGE_CHANGED_TEXT, VERSION_NOT_PICKED, VERSION_ROW_LABEL, VERSION_SEEN_TEXT, VERSION_SUB, VERSION_TITLE, canRestoreLot, clearedText, closesOnResultsPress,
  notReadReason, pickedVersionLine, pickedVersionText, referencesCountText, unconfirmedLine,
} from '../tools/extension-wasm/lib/journey.js';
import { leftOutLabel } from '../tools/extension-wasm/lib/skip.js';

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Undo after Clear restores only into the same page and tab', () => {
  const lot = { url: 'https://shop.example/item/1#a', tabId: 4 };
  assert.equal(canRestoreLot(lot, { tabUrl: 'https://shop.example/item/1#b', tabId: 4 }), true);
  assert.equal(canRestoreLot(lot, { tabUrl: 'https://shop.example/item/2', tabId: 4 }), false);
  assert.equal(canRestoreLot(lot, { tabUrl: 'https://shop.example/item/1', tabId: 9 }), false);
  assert.equal(canRestoreLot(lot, null), false);
  assert.equal(canRestoreLot({ url: null, tabId: null }, { tabUrl: 'https://x.example/', tabId: 1 }), true, 'an unknown lot page cannot be checked');
  assert.equal(PAGE_CHANGED_TEXT, 'The page has changed. Scan it again.');
});

test('a press in the results closes action and plain toasts, never the scan summary or an error', () => {
  assert.equal(closesOnResultsPress({ hidden: false, isStatus: false, isError: false }), true);
  assert.equal(closesOnResultsPress({ hidden: false, isStatus: true, isError: false }), false);
  assert.equal(closesOnResultsPress({ hidden: false, isStatus: false, isError: true }), false);
  assert.equal(closesOnResultsPress({ hidden: true, isStatus: false, isError: false }), false);
});

test('"Picked: <set>" shows only for a version the user picked', () => {
  const card = { identity: { set: 'Jungle' }, setConfirmed: true };
  assert.equal(pickedVersionLine(card), null);
  assert.equal(pickedVersionLine({ ...card, userConfirmed: true }), 'Picked: Jungle');
  assert.equal(pickedVersionLine({ ...card, userConfirmed: true, setConfirmed: false }), null);
  assert.equal(pickedVersionLine({ userConfirmed: true, setConfirmed: true, identity: {} }), null);
});

test('the lot card calls skipped and removed cards "Left out", and its stats carry no leading dot when they wrap', () => {
  assert.equal(leftOutLabel(2, 0), 'Left out');
  assert.equal(leftOutLabel(2, 1), 'Left out');
  assert.equal(leftOutLabel(2, 2), 'Left out');
  const css = src('tools/extension-wasm/ui/popup.css');
  assert.doesNotMatch(css, /\.lt-item[^{]*::before\s*\{[^}]*content:\s*"·"/);
});

test('the "Not read" heading is not recounted from every compact row in the list', () => {
  assert.doesNotMatch(src('tools/extension-wasm/popup.js'), /unrecognisedLabel\(resultsEl\.querySelectorAll/);
});

test('the title never wraps', () => {
  const css = src('tools/extension-wasm/ui/popup.css');
  assert.match(css.match(/\n\.logo \{[^}]*\}/)[0], /white-space: nowrap/);
});

const named = (extra = {}) => ({ identity: { id: 'a-1', name: 'Pikachu' }, confidence: 0.9, abstain: false, ...extra });
const unsure = (extra = {}) => ({ identity: { name: 'Mew' }, confidence: 0.3, abstain: true, candidates: [{ id: 'm-1' }], ...extra });
const openVersion = (extra = {}) => ({ identity: { id: 'base1-4', name: 'Charizard' }, confidence: 0.79, abstain: false,
  setChoices: [{ id: 'base1-4' }, { id: 'base4-4' }], setRange: { low: 120, high: 950, count: 2 }, ...extra });
const hidden = () => ({ notCard: true, cardBack: true, abstain: true, identity: null });

// The lot card, the group headings, the review button, the toast and the scan summary read these counts and nothing else.
test('one function counts found, to confirm, versions to pick and need you; removed and hidden cards are in none', () => {
  const cards = [named(), unsure(), unsure(), openVersion(), { ...unsure(), skipped: true, removed: true }, hidden()];
  assert.deepEqual(lotCounts(cards), { found: 4, toConfirm: 2, toPick: 1, needYou: 3 });
  assert.equal(scanSummary(cards), 'Found 4 cards · 3 need you');
  assert.deepEqual(lotCounts([]), { found: 0, toConfirm: 0, toPick: 0, needYou: 0 });
  // A card still pricing after a pick is confirmed, not to confirm.
  assert.equal(lotCounts([unsure({ pricing: true })]).toConfirm, 0);
});

test('group headings: "Pick a version (n)", and the review button counts the cards it shows', () => {
  assert.equal(chooseHeading(3), 'To confirm (3)');
  assert.equal(pickPrintingHeading(2), 'Pick a version (2)');
  assert.equal(reviewLabel(4), 'Review these 4 together');
});

test('skip is "Skip this card"', () => {
  assert.equal(SKIP_LABEL, 'Skip this card');
});

test('the lot card figure is "· 3 cards" and the unconfirmed line is quiet text', () => {
  assert.equal(unconfirmedLine(2, 145), 'Unconfirmed · ~$145.00 · 2 cards');
  assert.equal(unconfirmedLine(1, 3.5), 'Unconfirmed · ~$3.50 · 1 card');
});

test('versions: one name, one title, one subline', () => {
  assert.equal(VERSION_TITLE, 'Which version is it?');
  assert.equal(VERSION_SUB, 'Several versions. Pick yours for the exact price.');
  assert.equal(pickedVersionText('Jungle'), 'Picked: Jungle');
  assert.equal(EDITION_LABEL, 'All Base Set cards are…');
  assert.equal(HIGH_VALUE_TEXT, 'High value · check the match');
  assert.equal(printingNote({ variants: { a: { market: 1 }, b: { market: 2 }, c: { market: 3 } } }), '3 versions · $1.00–$3.00');
});

const sure = (extra = {}) => ({ identity: { id: 'x', name: 'Eevee', set: 'Jungle', number: '51' }, confidence: 0.9, setConfirmed: true,
  price_grid: { source: 'pokemontcg', updatedAt: new Date().toISOString(), variants: { normal: { market: 5, conditions: { NM: 5 } } } }, ...extra });

test('export: "Copy list (3)", "Download CSV (3)", and the copy toast names the value and what is left out', () => {
  const l = lotExportLabels(3, 2, 0, 0, 14.5);
  assert.equal(l.copy, 'Copy list (3)');
  assert.equal(l.csv, 'Download CSV (3)');
  assert.equal(l.copied, 'Copied 3 cards · $14.50 · 2 unconfirmed left out');
  assert.equal(lotExportLabels(3, 0, 0, 0, 14.5).copied, 'Copied 3 cards · $14.50');
  assert.equal(lotExportLabels(1, 0, 0, 0, 5).copied, 'Copied 1 card · $5.00');
  const lot = lotExportRows([sure(), sure(), unsure()], () => null, ['NM']);
  assert.equal(lot.total, 10);
});

test('the bottom groups share one naming pattern and each row gives its reason', () => {
  assert.equal(unrecognisedLabel(2, false), 'Not read (2)');
  assert.equal(unrecognisedLabel(2, true), 'Not read (2)');
  assert.equal(notCardHeading(1), 'Not a card (1)');
  assert.equal(skippedHeading(3, 1), 'Left out (3)');
  assert.equal(notReadReason({ cardBack: true }), 'Card back. Turn it over.');
  assert.equal(notReadReason({ cardBack: true, tooSmall: true }), 'Too small.');
  assert.match(renderSkippedRow(0, null, false), /Skipped\./);
  assert.match(renderSkippedRow(0, null, true), /Removed\./);
});

test('Clear with a lot says how many cards went and offers Undo', () => {
  assert.equal(clearedText(9), 'Cleared 9 cards');
  assert.equal(clearedText(1), 'Cleared 1 card');
  assert.equal(CLEARED_TOAST.label, 'Undo');
});

test('the options page names the switch and counts cards remembered', () => {
  assert.equal(referencesCountText(0), '0 cards remembered');
  assert.equal(referencesCountText(1), '1 card remembered');
  assert.equal(referencesCountText(12), '12 cards remembered');
  const html = readFileSync(new URL('../tools/extension-wasm/options.html', import.meta.url), 'utf8');
  assert.match(html, /unless you turn on Help improve recognition for everyone\./);
  assert.doesNotMatch(html, /turn on shared learning above/);
});

test('the header button is "Add card" with a tooltip, and the slider and eye say what they do', () => {
  const html = readFileSync(new URL('../tools/extension-wasm/popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-draw"[^>]*>[\s\S]*?<\/svg><span class="draw-label">Add card<\/span>/);
  assert.match(html, /id="btn-draw"[^>]*title="Add card[^"]*"/);
  assert.match(html, /id="size-ctl"[^>]*title="Picture size"/);
  assert.match(html, /class="overlay-toggle" title="Show or hide the boxes on the page"/);
  assert.doesNotMatch(html, /Variant menu/);
  assert.match(html, /<option value="">All Base Set cards are…<\/option>/);
  const css = readFileSync(new URL('../tools/extension-wasm/ui/popup.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(min-width: 560px\)\s*\{[\s\S]*?\.draw-label/);
  assert.doesNotMatch(css, /@media \(min-width: 440px\)\s*\{[\s\S]*?\.draw-label/);
});

test('the Confirm button is never cut: wide enough for the name and free to take two lines', () => {
  const css = readFileSync(new URL('../tools/extension-wasm/ui/popup.css', import.meta.url), 'utf8');
  const rule = css.match(/\n\.choose-confirm \{[^}]*\}/)[0];
  assert.match(rule, /min-width: min\(100%, 200px\)/);
  assert.match(rule, /white-space: normal/);
  assert.doesNotMatch(rule, /overflow: hidden|text-overflow/);
});

test('final review: the version wording replaces printing, variant and finish in what the popup shows', () => {
  assert.equal(VERSION_NOT_PICKED, 'Version not picked. Pick it for one price.');
  assert.equal(NO_PRICE_FOR_VERSION, 'No price for this version');
  assert.equal(CHOOSE_VERSION_LABEL, 'Choose the version');
  assert.equal(VERSION_ROW_LABEL, 'Version');
  assert.equal(VERSION_SEEN_TEXT, 'Version seen on the card');
  const popup = src('tools/extension-wasm/popup.js');
  const priorText = src('tools/extension-wasm/lib/page-prior.js');
  for (const old of [
    /Printing not picked/, /No price for this printing/, /Choose the printing/, /Choose the finish/, /<span class="lbl">Variant</, /Variant seen on the card/,
    /over the printings\./, /pick the printing to settle/, /Suggested printing \$/, /confirm this printing/,
  ]) assert.doesNotMatch(popup, old, String(old));
  assert.doesNotMatch(priorText, /this printing before/);
  // The export keeps the headers existing spreadsheets read.
  assert.match(src('tools/extension-wasm/lib/lot-export.js'), /'Printing', 'Finish'/);
});

test('final review: every way a lot is replaced goes through resetLotUiState, which resets each per-lot map and flag', () => {
  const popup = src('tools/extension-wasm/popup.js');
  const body = (name) => popup.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n\\}\\r?\\n`))[0];
  for (const name of ['applyScanResult', 'restoreSession', 'restoreLotSnapshot']) assert.match(body(name), /resetLotUiState\(\)/, name);
  assert.match(popup, /_lastResult = null;\s*resetLotUiState\(\);/, 'Clear');
  assert.doesNotMatch(popup, /_whyOpen = new Set\(\);\s*_stripMore/, 'Clear no longer resets the why map by hand');
  const reset = body('resetLotUiState');
  for (const part of [/onLotReplaced\(\)/, /page-linked/, /_whyOpen = new Set\(\)/, /_changing = new Set\(\)/, /_picker = new Map\(\)/, /_autoSearch\.clear\(\)/, /_showNotCard = false/, /hideDock\(\)/]) assert.match(reset, part, String(part));
  // Undo re-applies what the snapshot saved after the reset.
  assert.match(body('restoreLotSnapshot'), /resetLotUiState\(\);\s*_lastResult = snap\.lastResult[\s\S]*_showNotCard = snap\.showNotCard/);
});
