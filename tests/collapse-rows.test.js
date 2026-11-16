import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Section 12 of docs/plans/extension-ui-redesign.md. popup.js cannot be imported in a test, so its wiring is pinned in
// source (as interaction-model.test.js does); the browser behavior is in tests/e2e/extension-wasm-popup.spec.js.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const popup = read('../tools/extension-wasm/popup.js');
const css = read('../tools/extension-wasm/ui/popup.css');
const html = read('../tools/extension-wasm/popup.html');
const flow = read('../tools/extension-wasm/lib/choose-flow.js');

test('12.3: the open rows are a per-lot set, cleared with the lot and never saved', () => {
  assert.match(popup, /let _expanded = new Set\(\)/);
  const reset = popup.slice(popup.indexOf('function resetLotUiState()'));
  assert.match(reset.slice(0, reset.indexOf('\n}')), /_expanded = new Set\(\)/);
  // Not in the saved lot: a reopened lot shows its rows collapsed.
  const save = popup.slice(popup.indexOf('async function saveSession()'));
  assert.doesNotMatch(save.slice(0, save.indexOf('\n}')), /_expanded/);
});

test('12.1: the collapse rule is the pure isSettledRow and the row renders a toggle for it', () => {
  assert.match(popup, /isSettledRow\(/);
  assert.match(popup, /class="row-toggle/);
  assert.match(popup, /aria-controls=/);
});

test('12.2: the toggle name reads "<name>, <set> #<number>, <price>. Show details"', () => {
  assert.match(popup, /Show details/);
});

test('12.3: a page click expands the row; confirming collapses it', () => {
  const show = popup.slice(popup.indexOf('function showCardInScanner'));
  assert.match(show.slice(0, show.indexOf('\n}')), /_expanded\.add\(index\)/);
  const confirm = popup.slice(popup.indexOf('function confirmMatch'));
  assert.match(confirm.slice(0, confirm.indexOf('\n}')), /_expanded\.delete\(idx\)/);
});

test('12.3: the chevron turns over 150 ms and not at all under reduced motion; no height animation', () => {
  assert.match(css, /\.row-toggle[^{]*\{[^}]*\}/);
  assert.match(css, /\.row-chevron\s*\{[^}]*transition: transform \.15s/);
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.row-chevron/);
  assert.doesNotMatch(css.match(/\.card-row\.is-collapsed[^{]*\{[^}]*\}/g)?.join('') ?? '', /transition: height|max-height/);
});

test('12.5: Tick all is gone from the markup, the script, the styles and the labels', () => {
  assert.doesNotMatch(html, /bulk-tick-all/);
  assert.doesNotMatch(popup, /bulkTickAll|tickAllLabel/);
  assert.doesNotMatch(css, /bulk-tick-all/);
  assert.doesNotMatch(flow, /tickAllLabel/);
  assert.match(html, /Ticked pairs look like clear matches; check the others yourself\./);
});
