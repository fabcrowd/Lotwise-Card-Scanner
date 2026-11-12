import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hiddenCount, isNotCard, notCardEntry, overlayCards, renderNotCardGroup, showNotCard } from '../tools/extension-wasm/lib/not-card.js';
import { classifyCard, lotEstimate, scanStatus, splitByRecognition } from '../tools/extension-wasm/lib/card-display.js';
import { chooseState } from '../tools/extension-wasm/lib/choose-flow.js';
import { lotExportRows } from '../tools/extension-wasm/lib/lot-export.js';
import { collectBatchIds } from '../tools/extension-wasm/lib/batch-price.js';

const read = { identity: { id: 'base1-4', name: 'Charizard' }, confidence: 0.9, abstain: false, market_price: null, price_grid: null, nearest: ['base1-4'] };
const hidden = () => notCardEntry({ box: [1, 2, 3, 4], score: 0.8, read, readHeight: 120, via: 'yolo-in-photo' });
const tiny = () => notCardEntry({ box: [1, 2, 20, 30], score: 0.5, read: null, readHeight: 30, tooSmall: true });
const real = { identity: { id: 'x-1', name: 'Pikachu' }, confidence: 0.95, abstain: false, setConfirmed: true, price_grid: null };

test('a rejected box becomes a hidden notCard entry that carries its read and no identity or price', () => {
  const card = hidden();
  assert.equal(card.notCard, true);
  assert.equal(card.cardBack, true);
  assert.equal(card.abstain, true);
  assert.equal(card.identity, null);
  assert.equal(card.market_price, null);
  assert.equal(card.price_grid, null);
  assert.deepEqual(card.hiddenRead, read);
  assert.deepEqual(card.box, [1, 2, 3, 4]);
  assert.equal(isNotCard(card), true);
});

test('a rejected too-small box is a hidden entry with no read', () => {
  const card = tiny();
  assert.equal(card.notCard, true);
  assert.equal(card.tooSmall, true);
  assert.equal(card.hiddenRead, null);
});

test('hidden entries stay out of totals, export, status, batch pricing and the overlay', () => {
  const cards = [real, hidden(), tiny()];
  assert.equal(lotEstimate(cards, () => null).total, 1);
  assert.deepEqual(lotExportRows(cards, () => null), lotExportRows([real], () => null));
  assert.equal(scanStatus(cards), scanStatus([real]));
  assert.equal(classifyCard(hidden()), 'hidden');
  assert.deepEqual(splitByRecognition(cards).notCard, [1, 2]);
  assert.deepEqual(splitByRecognition(cards).hidden, []);
  assert.deepEqual([...collectBatchIds(cards)], ['x-1']);
  assert.equal(hiddenCount(cards), 2);
  const overlay = overlayCards(cards);
  assert.equal(overlay[0], real);
  assert.equal(overlay[1].box, null);
  assert.equal(overlay[1].hiddenRead, undefined);
  assert.equal(overlay[2].box, null);
});

test('Show it turns a hidden read into a Choose row that is never confirmed', () => {
  const shown = showNotCard(hidden());
  assert.equal(shown.notCard, undefined);
  assert.equal(shown.hiddenRead, undefined);
  assert.equal(chooseState(shown), 'choose');
  assert.equal(shown.identity.id, 'base1-4');
  assert.equal(shown.unsure, true);
  assert.notEqual(shown.setConfirmed, true);
  assert.deepEqual(shown.box, [1, 2, 3, 4]);
  assert.equal(shown.readHeight, 120);
});

test('Show it on a too-small entry gives the Too small row', () => {
  const shown = showNotCard(tiny());
  assert.equal(shown.notCard, undefined);
  assert.equal(shown.tooSmall, true);
  assert.equal(chooseState(shown), 'back');
});

test('the popup group is collapsed, headed "Hidden: not a card (N)", with a Show it button per row', () => {
  const html = renderNotCardGroup('<div>rows</div>', 2, false);
  assert.match(html, /Hidden: not a card \(2\)/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="notcard-list"[^>]*hidden/);
  assert.equal(renderNotCardGroup('', 0, false), '');
});

// ---- review fixes ----
import { HIDDEN_READ_CAP, UNREAD_ROW_TEXT, canReadHidden, keepHidden, keptRealCount, realCards, shownMessage } from '../tools/extension-wasm/lib/not-card.js';
import { MAX_CARDS, cardRoom, claimSlot } from '../tools/extension-wasm/lib/page-scan.js';
import { smallPhotoCounts } from '../tools/extension-wasm/lib/tiny-card.js';
import { readFileSync } from 'node:fs';

const srcOf = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('realCards and keptRealCount ignore hidden entries and dropped slots', () => {
  const cards = [real, hidden(), tiny(), real];
  assert.deepEqual(realCards(cards), [real, real]);
  assert.equal(keptRealCount(cards), 2);
  assert.equal(keptRealCount(cards, new Set([0, 1])), 1);
});

test('hidden entries do not use up the card room', () => {
  const cards = [...Array(MAX_CARDS)].map(() => hidden());
  assert.equal(cardRoom(keptRealCount(cards)), MAX_CARDS);
});

test('background counts only real cards for the fallbacks, the sealed check and the cap', () => {
  const bg = srcOf('tools/extension-wasm/background.js');
  assert.doesNotMatch(bg, /const triedFallback = !cards\.length/);
  assert.doesNotMatch(bg, /if \(cards\.length === 0 && focus\.kind/);
  assert.doesNotMatch(bg, /detectedCards: cards\.length/);
  assert.doesNotMatch(bg, /cardRoom\(cards\.length - dropped\.size\)/);
  assert.doesNotMatch(bg, /claimSlot\(slots, dropped, slot, cards\.length - dropped\.size\)/);
  assert.match(bg, /keptRealCount\(cards, dropped\)/);
  assert.match(bg, /!realCards\(cards\)\.length && !sealed/);
  assert.match(bg, /detectedCards: realCards\(cards\)\.length/);
});

test('full reads of rejected boxes are capped; beyond the cap the entry is unread', () => {
  assert.equal(HIDDEN_READ_CAP, 12);
  assert.equal(canReadHidden(11), true);
  assert.equal(canReadHidden(12), false);
  const card = notCardEntry({ box: [1, 2, 3, 4], score: 0.5, read: null, readHeight: 100, unread: true });
  assert.equal(card.unread, true);
  assert.equal(card.hiddenRead, null);
  assert.equal(hidden().unread, undefined);
  assert.equal(tiny().unread, undefined);
});

test('Show it on an unread entry is a not-read, unconfirmable row', () => {
  const shown = showNotCard(notCardEntry({ box: [1, 2, 3, 4], score: 0.5, read: null, readHeight: 100, unread: true }));
  assert.equal(shown.notCard, undefined);
  assert.equal(shown.unread, true);
  assert.equal(chooseState(shown), 'back');
  assert.equal(shown.price_grid, null);
  assert.equal(UNREAD_ROW_TEXT, 'Not read. Draw a box around it to read it.');
});

test('the scan loop caps hidden reads', () => {
  const bg = srcOf('tools/extension-wasm/background.js');
  assert.match(bg, /canReadHidden\(/);
  assert.match(bg, /unread/);
  assert.match(srcOf('tools/extension-wasm/popup.js'), /UNREAD_ROW_TEXT/);
});

test('a later real view of a spot replaces a hidden entry; a hidden view never replaces', () => {
  const hiddenSlot = { docBox: [0, 0, 100, 140], anchor: null, area: 14000, hidden: true };
  const slots = [hiddenSlot];
  const small = { docBox: [0, 0, 100, 140], anchor: null, area: 10000 };
  assert.deepEqual(claimSlot(slots, new Set(), small, 0), { verdict: 'replace', drop: 0 });
  const realSlot = { docBox: [0, 0, 100, 140], anchor: null, area: 100 };
  const hiddenView = { docBox: [0, 0, 100, 140], anchor: null, area: 99999, hidden: true };
  assert.equal(claimSlot([realSlot], new Set(), hiddenView, 1).verdict, 'skip');
  // two hidden views of one spot: the usual rule
  assert.equal(claimSlot([hiddenSlot], new Set(), { ...hiddenView, area: 1 }, 0).verdict, 'skip');
});

test('a hidden too-small gallery box follows the keepTooSmall rule', () => {
  const claimed = { docBox: [0, 0, 1, 1] };
  assert.equal(keepHidden({ tooSmall: true, claimed, mappedBox: null, gallery: true }), false);
  assert.equal(keepHidden({ tooSmall: true, claimed, mappedBox: [0, 0, 1, 1], gallery: true }), true);
  assert.equal(keepHidden({ tooSmall: true, claimed: { ...claimed, replaces: 3 }, mappedBox: [0, 0, 1, 1] }), false);
  assert.equal(keepHidden({ tooSmall: false, claimed, mappedBox: null, gallery: true }), true);
  assert.equal(keepHidden({ tooSmall: false, claimed: null, mappedBox: null }), false);
  assert.equal(keepHidden({ tooSmall: false, claimed: { ...claimed, replaces: 3 }, mappedBox: null }), false);
});

test('hidden entries do not count as small photo reads', () => {
  const small = { identity: { id: 'a' }, readHeight: 50 };
  assert.deepEqual(smallPhotoCounts([small, tiny(), hidden()], 100), { read: 1, small: 1 });
  const bg = srcOf('tools/extension-wasm/background.js');
  assert.match(bg, /!c\.notCard && \(!c\.cardBack \|\| c\.tooSmall\)/);
});

test('Show it names a card back instead of counting it to confirm', () => {
  const back = notCardEntry({ box: [1, 2, 3, 4], score: 0.5, read: { ...read, cardBack: true }, readHeight: 100 });
  const shown = showNotCard(back);
  assert.equal(shownMessage(shown, 3), 'It reads as a card back.');
  assert.equal(shownMessage(showNotCard(hidden()), 3), 'Shown. 3 to confirm.');
  assert.equal(shownMessage(showNotCard(tiny()), 3), 'Shown as too small to read.');
});

test('the score and harness scripts leave hidden entries out', () => {
  assert.match(srcOf('scripts/sealed-score.mjs'), /response\.cards\.filter\(\(card\) => !card\.notCard\)/);
  assert.match(srcOf('scripts/realworld-run.mjs'), /data-show-hidden/);
});
