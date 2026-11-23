import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Section 10 of docs/plans/extension-ui-redesign.md, "One interaction model". popup.js, background.js and the stylesheet
// cannot be imported in a test, so their wiring is pinned in source (as pending-show.test.js does); the browser behavior
// is in tests/e2e/extension-wasm-popup.spec.js.
const src = (name) => readFileSync(new URL(`../tools/extension-wasm/${name}`, import.meta.url), 'utf8');
const popup = src('popup.js');
const css = src('ui/popup.css');
const background = src('background.js');
// The onMessage listener that holds the text at `at`, up to its closing line.
const listenerAt = (at) => {
  const start = popup.lastIndexOf('chrome.runtime.onMessage.addListener', at);
  return popup.slice(start, popup.indexOf('\n});', at));
};

test('10.2 page hover: the popup takes overlayHover only through acceptPickSender, never scrolls, and does not echo it back to the page', () => {
  const at = popup.indexOf('"overlayHover"');
  assert.ok(at > 0, 'a handler for overlayHover');
  const handler = listenerAt(at);
  assert.match(handler, /acceptPickSender\(sender, chrome\.runtime\.id, _lotUrl\)/);
  assert.match(handler, /Number\.isInteger\(msg\.index\)|msg\.index === null/);
  assert.doesNotMatch(handler, /scrollIntoView|highlightOnPage/, 'a page hover never scrolls and is not sent back');
  assert.match(css, /\.card-row\.page-linked[^{]*\{[^}]*var\(--brand-tint\)/, 'the soft linked ring uses --brand-tint');
});

test('10.2 page hover: the dock shows the hovered card\'s crop at once, as hovering the row does', () => {
  assert.match(listenerAt(popup.indexOf('"overlayHover"')), /showDock\(/);
});

test('10.2 full-size pill: the page message and the popup button share one function; the background only opens or focuses the scanner', () => {
  assert.match(popup, /async function openFullSizePhoto\(/);
  assert.match(popup, /fullSizeOpen\?\.addEventListener\("click", \(\) => openFullSizePhoto\(\)\)/);
  const at = popup.indexOf('"overlayFullSize"');
  assert.ok(at > 0, 'the popup answers overlayFullSize');
  const handler = listenerAt(at);
  assert.match(handler, /acceptPickSender\(sender, chrome\.runtime\.id, _lotUrl\)/);
  assert.match(handler, /openFullSizePhoto\(/);
  assert.doesNotMatch(handler, /tabs\.create|permissions\.request/, 'the message reuses the button\'s path, it does not copy it');
  assert.match(background, /case "overlayFullSize":[\s\S]{0,600}acceptPageSender\([\s\S]{0,300}openOrFocusScanner\(sender\.tab[,)]/);
});

test('10.2 full-size pill: with site access already granted the path runs with no request; without it the pill only focuses the button; a closed window gets a pending record', () => {
  const fn = popup.slice(popup.indexOf('async function openFullSizePhoto('), popup.indexOf('chrome.tabs.onUpdated'));
  assert.match(fn, /permissions\.contains\(/);
  assert.ok(fn.indexOf('permissions.contains(') < fn.indexOf('permissions.request('), 'contains is asked first');
  assert.match(fn, /fromPage[\s\S]{0,200}fullSizeOpen\.focus\(\)/, 'from the page and not granted: focus the button, no request');
  assert.match(background, /case "overlayFullSize":[\s\S]{0,600}openOrFocusScanner\(sender\.tab, \(\) => savePendingFullSize\(chrome\.storage\.session, \{ url: sender\.tab\.url \}\), \(\) => clearPendingShow\(chrome\.storage\.session\)\)/);
  const init = popup.slice(popup.lastIndexOf('(async () => {'));
  assert.ok(init.indexOf('await recoverLot()') < init.indexOf('matchPendingFullSize(held, _lotUrl)'), 'applied after the lot is restored');
});

test('10.2 toasts: an action runs only on the lot and card it was made for, and a replaced lot closes it', () => {
  assert.match(popup, /const changeAction = \(idx\) => \{[\s\S]{0,400}_lastResult\?\.scanId !== scanId/);
  assert.match(popup, /const putBackAction = \(idx\) => \{[\s\S]{0,400}_lastResult\?\.scanId !== scanId/);
  assert.equal((popup.match(/resetLotUiState\(\);/g) || []).length, 4, 'a clear, a new scan, a restored session and Undo each reset the lot state, which calls onLotReplaced');
  assert.match(popup, /function resetLotUiState\(\) \{\s*onLotReplaced\(\);/);
  assert.match(popup, /function onLotReplaced\(\) \{[\s\S]{0,300}_pageLinked = null/);
});

test('10.2 draw mode: the header crosshair is a toggle with aria-pressed, and the popup hears when the page ends draw mode', () => {
  assert.match(popup, /btnDraw\.setAttribute\("aria-pressed"/);
  assert.match(popup, /btnDraw\.addEventListener\("click", \(\) => \(_drawPending \? cancelDrawBox\(\) : startDrawBox\(\)\)\)/);
  assert.match(popup, /msg\?\.action !== "drawEnded"/);
});

test('10.2 choose rows: the crop\'s brackets brighten on hover and focus; candidate tiles get a check badge on hover and focus', () => {
  assert.match(css, /\.scanned-card:hover::before,\s*\.scanned-card:focus-visible::before[^{]*\{[^}]*filter/);
  assert.match(css, /\.pick-card\[data-pick\]:hover::before,\s*\.pick-card\[data-pick\]:focus-visible::before[^{]*\{[^}]*opacity: 1/);
});

test('10.2 rows: a compact row\'s thumbnail is a focusable show-on-page button with the crop\'s hover and focus style', () => {
  assert.match(popup, /<button type="button" class="unrec-thumb" data-show-on-page data-idx="\$\{idx\}"/);
  assert.match(css, /\.unrec-thumb:hover::before,\s*\.unrec-thumb:focus-visible::before[^{]*\{[^}]*filter/);
});

test('10.2 review dialog: a pair\'s checkbox stands for its picture in the preview', () => {
  assert.match(popup, /focusTile: \(el\) => /);
  assert.match(popup, /\.bulk-keep/);
});

test('10.2 toasts: an action toast stays 8 s and pauses while hovered or focused; pick offers Change; skip and remove offer Put back', () => {
  assert.match(popup, /const TOAST_ACTION_MS = 8000;/);
  assert.match(popup, /function showMessage\(text, isError = false, isStatus = false, action = null\)/);
  assert.match(popup, /label: "Change", run: \(\) => \{[\s\S]{0,300}startChange\(idx\);/);
  assert.match(popup, /label: "Put back", run: \(\) => \{[\s\S]{0,200}putBackAt\(idx\);/);
  assert.doesNotMatch(popup, /Put it back from "Removed"/, 'the text that says where Put back is is replaced by the button');
  assert.match(css, /\.msg-bar \.toast-action/);
});

test('10.1 rule 6: no hover delay is added in the popup; the loupe keeps 150 ms in and 80 ms out and the linked paths use none', () => {
  const loupe = src('lib/loupe.js');
  assert.match(loupe, /delayMs = 150, leaveMs = 80/);
  const linked = popup.slice(popup.indexOf('let _highlighted'), popup.indexOf('resultsEl.addEventListener("keydown"'));
  assert.doesNotMatch(linked, /setTimeout/, 'row hover to page highlight is immediate');
  assert.doesNotMatch(css, /transition-delay/);
});
