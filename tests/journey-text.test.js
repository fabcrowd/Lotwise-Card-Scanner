import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OPEN_A_LISTING, SETUP_FINISH_FIRST, fullSizeOfferText, isUnreadableTabError, nextNotice, restoredText, scanActivityText, scanButtonLabel, scanProgressUpdate, scanDisabledReason, setupProgressText,
} from '../tools/extension-wasm/lib/journey.js';

// Section 11.1 and 11.2 of docs/plans/extension-ui-redesign.md: the words of the first scan, one name per idea.

test('the download progress reads "Downloading 2 of 3 · 42%"', () => {
  assert.equal(setupProgressText(1, 3, 42), 'Downloading 2 of 3 · 42%');
  assert.equal(setupProgressText(0, 5, 0), 'Downloading 1 of 5 · 0%');
});

test('a disabled Scan Page says why: setup first, then a tab it cannot read', () => {
  assert.equal(scanDisabledReason({ ready: false, tabUrl: 'https://example.com/', tabId: 4 }), SETUP_FINISH_FIRST);
  assert.equal(SETUP_FINISH_FIRST, 'Finish setup first');
  assert.equal(scanDisabledReason({ ready: true, tabUrl: 'chrome://extensions/', tabId: 4 }), OPEN_A_LISTING);
  assert.equal(scanDisabledReason({ ready: true, tabUrl: null, tabId: null }), OPEN_A_LISTING);
  assert.equal(OPEN_A_LISTING, 'Open a listing on Facebook Marketplace, Mercari or another site, then press Scan Page');
  // A tab whose address the browser hides is unknown, not unreadable.
  assert.equal(scanDisabledReason({ ready: true, tabUrl: null, tabId: 4 }), '');
  assert.equal(scanDisabledReason({ ready: true, tabUrl: 'https://www.mercari.com/us/item/1', tabId: 4 }), '');
});

test('a scan that failed on an unreadable tab is told apart from other failures', () => {
  assert.equal(isUnreadableTabError('Lotwise cannot read this tab. Click the Lotwise icon while you are on the page you want to scan.'), true);
  assert.equal(isUnreadableTabError('No scannable tab — open a webpage first'), true);
  assert.equal(isUnreadableTabError('That tab is no longer in front. Scan again.'), false);
  assert.equal(isUnreadableTabError(undefined), false);
});

test('the scanning line says "Looking for cards…", then how many it is reading', () => {
  assert.equal(scanActivityText(0), 'Looking for cards…');
  assert.equal(scanActivityText(1), 'Reading 1 card…');
  assert.equal(scanActivityText(6), 'Reading 6 cards…');
});

test('scan progress counts only for the scan the popup started, and never writes "undefined"', () => {
  const msg = (extra) => ({ action: 'scanProgress', ...extra });
  assert.deepEqual(scanProgressUpdate(msg({ found: 6, tabId: 3 }), 3), { activity: 'Reading 6 cards…' });
  assert.deepEqual(scanProgressUpdate(msg({ screen: 2, screens: 5, tabId: 3 }), 3), { activity: 'Scanning screen 2 of 5…' });
  // Another tab's scan is not this one.
  assert.equal(scanProgressUpdate(msg({ found: 6, tabId: 9 }), 3), null);
  assert.equal(scanProgressUpdate(msg({ screen: 1, screens: 2, tabId: 9 }), 3), null);
  // A side that does not know its tab accepts the message.
  assert.deepEqual(scanProgressUpdate(msg({ found: 2 }), 3), { activity: 'Reading 2 cards…' });
  assert.deepEqual(scanProgressUpdate(msg({ found: 2, tabId: 3 }), null), { activity: 'Reading 2 cards…' });
  // Neither a count nor a screen: nothing to say, the current text stays.
  assert.equal(scanProgressUpdate(msg({ tabId: 3 }), 3), null);
  assert.equal(scanProgressUpdate(msg({ screen: 2, tabId: 3 }), 3), null);
  assert.equal(scanProgressUpdate({ action: 'setupProgress', found: 4 }, 3), null);
});

test('the scan button says "Scan again" once a lot is shown', () => {
  assert.equal(scanButtonLabel({ scanning: false, hasLot: false }), 'SCAN PAGE');
  assert.equal(scanButtonLabel({ scanning: false, hasLot: true }), 'SCAN AGAIN');
  assert.equal(scanButtonLabel({ scanning: true, hasLot: true }), 'SCANNING…');
});

test('notices come one at a time, access first', () => {
  assert.equal(nextNotice({ access: true, fullsize: true, restore: true }), 'access');
  assert.equal(nextNotice({ access: false, fullsize: true, restore: true }), 'fullsize');
  assert.equal(nextNotice({ restore: true }), 'restore');
  assert.equal(nextNotice({}), null);
});

test('the full-size and restored notices use the spec wording', () => {
  assert.equal(fullSizeOfferText(), 'Some cards are small. Open the full-size photo to read them better.');
  assert.equal(restoredText(12), 'Restored your last scan (12 min ago).');
  assert.equal(restoredText(0), 'Restored your last scan (just now).');
});

const html = readFileSync(new URL('../tools/extension-wasm/popup.html', import.meta.url), 'utf8');
const wizardStep = (id) => html.match(new RegExp(`<div class="wiz-section" id="${id}">[\\s\\S]*?\\n    </div>`))?.[0] ?? '';

test('wizard step 1 explains the one-time download and its only button is Download', () => {
  const step = wizardStep('wiz-step-1');
  assert.match(step, /One-time download \(<b id="setup-size">[^<]*<\/b>\)\. After that, everything runs on your computer\. No account needed\./);
  assert.match(step, /<button id="btn-setup">Download<\/button>/);
  assert.match(step, /Keep this window open/);
  assert.match(step, /id="btn-setup-retry"[^>]*>Retry</);
  assert.doesNotMatch(step, /Download models|AI models/);
});

test('wizard steps 2 and 3 are tagged Optional and carry a visible way to skip', () => {
  for (const id of ['wiz-step-access', 'wiz-step-2']) {
    const step = wizardStep(id);
    assert.match(step, /class="wiz-optional"[^>]*>Optional</, id);
  }
  // The access step's skip is "Not now" (11.1 names it); step 3's is "Skip".
  assert.match(wizardStep('wiz-step-access'), /class="wiz-skip" id="btn-wiz-access-skip">Not now</);
  assert.match(wizardStep('wiz-step-2'), /class="wiz-skip" id="btn-wiz-skip">Skip</);
});

test('wizard step 3 drops the grade and condition abbreviations', () => {
  const step = wizardStep('wiz-step-2');
  assert.doesNotMatch(step, /NM|LP|MP|HP|DMG|PSA|BGS|CGC|SGC/);
});

test('the access step is plain, with Allow and Not now, and "without your cookies" is a tooltip', () => {
  const step = wizardStep('wiz-step-access');
  assert.match(step, /Read the original, sharper photos on Marketplace\? It finds more cards\./);
  assert.match(step, /id="btn-wiz-access"[^>]*>Allow</);
  assert.match(step, /id="btn-wiz-access-skip">Not now</);
  const visible = step.replace(/title="[^"]*"/g, '');
  assert.doesNotMatch(visible, /without your cookies/);
  assert.match(step, /title="[^"]*without your cookies/);
});

test('the empty mark has a line for why Scan Page is disabled', () => {
  assert.match(html, /<p class="empty-why" id="empty-why" hidden><\/p>/);
});

test('one scan status line sits directly under the action bar, outside the empty state', () => {
  assert.match(html, /<p class="scan-status" id="scan-status" role="status" hidden><\/p>/);
  const bar = html.indexOf('class="action-bar"');
  const status = html.indexOf('id="scan-status"');
  const main = html.indexOf('<main class="scroll">');
  const empty = html.indexOf('id="empty-hint"');
  assert.ok(bar > -1 && bar < status && status < main && main < empty, 'under the Scan button row, before the results');
});
