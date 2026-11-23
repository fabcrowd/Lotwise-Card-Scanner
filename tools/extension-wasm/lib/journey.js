// The words of the first scan (section 11.1 and 11.2 of docs/plans/extension-ui-redesign.md), as pure functions so a test
// can pin them. One name per idea: "version", "unconfirmed", "skip".

import { isSameLot } from './draw-box.js';

const plural = (n, one, many) => (n === 1 ? one : many);

/** The wizard's download line: which file of how many, and how far that file is. */
export function setupProgressText(fileIndex, totalFiles, pct) {
  return `Downloading ${fileIndex + 1} of ${totalFiles} · ${pct}%`;
}

export const SETUP_FINISH_FIRST = 'Finish setup first';
export const OPEN_A_LISTING = 'Open a listing on Facebook Marketplace, Mercari or another site, then press Scan Page';

/**
 * Why Scan Page cannot run, as the line under the empty mark; '' when nothing is in the way. A tab whose address the
 * browser hides (a url of null with a tab id) is unknown, not unreadable.
 */
export function scanDisabledReason({ ready, tabUrl, tabId }) {
  if (!ready) return SETUP_FINISH_FIRST;
  if (tabId == null && !tabUrl) return OPEN_A_LISTING;
  if (tabUrl && !/^https?:/i.test(tabUrl)) return OPEN_A_LISTING;
  return '';
}

/** A scan that failed because the tab is not a page it can read (the background's two messages for it). */
export const isUnreadableTabError = (message) => /cannot read this tab|no scannable tab/i.test(String(message || ''));

/** The line that stays while a scan runs: "Looking for cards…", then how many boxes it is reading. */
export function scanActivityText(found) {
  return found > 0 ? `Reading ${found} ${plural(found, 'card', 'cards')}…` : 'Looking for cards…';
}

/**
 * What a "scanProgress" message changes on the status line, as { activity }, or null when it is not for this scan or says
 * nothing (the current text stays). `scanTabId` is the tab the popup's own scan reads; a side that does not know its tab accepts.
 */
export function scanProgressUpdate(msg, scanTabId) {
  if (msg?.action !== 'scanProgress') return null;
  if (scanTabId != null && msg.tabId != null && msg.tabId !== scanTabId) return null;
  if (Number.isInteger(msg.found)) return { activity: scanActivityText(msg.found) };
  if (Number.isInteger(msg.screen) && Number.isInteger(msg.screens)) return { activity: `Scanning screen ${msg.screen} of ${msg.screens}…` };
  return null;
}

/** The scan button's label: "Scan again" once a lot is shown. */
export function scanButtonLabel({ scanning, hasLot }) {
  if (scanning) return 'SCANNING…';
  return hasLot ? 'SCAN AGAIN' : 'SCAN PAGE';
}

/** Notices show one at a time, in this order. */
export const NOTICE_ORDER = ['access', 'fullsize', 'restore'];
export function nextNotice(wants) {
  return NOTICE_ORDER.find((name) => wants?.[name] === true) ?? null;
}

// ─── Section 11.4 to 11.7: the confirm, version, export, clear and header words ───

const money = (n) => `$${Number(n).toFixed(2)}`;

/** The quiet line under the lot figures for the cards still to confirm: "Unconfirmed · ~$145.00 · 2 cards". */
export const unconfirmedLine = (count, total) => `Unconfirmed · ~${money(total)} · ${count} ${plural(count, 'card', 'cards')}`;

export const VERSION_TITLE = 'Which version is it?';
export const VERSION_SUB = 'Several versions. Pick yours for the exact price.';
export const pickedVersionText = (setName) => `Picked: ${setName}`;
/** "Picked: Jungle" when the user picked this card's version (a pick sets userConfirmed); null for a set the scanner settled. */
export const pickedVersionLine = (card) => (card?.userConfirmed === true && card.setConfirmed === true && card.identity?.set ? pickedVersionText(card.identity.set) : null);
export const VERSION_NOT_PICKED = 'Version not picked. Pick it for one price.';
export const NO_PRICE_FOR_VERSION = 'No price for this version';
export const CHOOSE_VERSION_LABEL = 'Choose the version';
export const VERSION_ROW_LABEL = 'Version';
export const VERSION_SEEN_TEXT = 'Version seen on the card';
export const EDITION_LABEL = 'All Base Set cards are…';
export const HIGH_VALUE_TEXT = 'High value · check the match';

/** Why a card sits in "Not read": its own reason, one short sentence. */
export function notReadReason(card) {
  if (card?.tooSmall) return 'Too small.';
  if (card?.unread) return 'Not read. Draw a box around it to read it.';
  return 'Card back. Turn it over.';
}

export const PAGE_CHANGED_TEXT = 'The page has changed. Scan it again.';

/**
 * Undo after Clear puts the lot back only where it came from: the same page and, when both tab ids are known, the same
 * tab. A lot whose page was never known cannot be checked and is restored. `state` is the scanState reply.
 */
export function canRestoreLot(lot, state) {
  if (!state) return false;
  if (!lot?.url) return true;
  return isSameLot(lot, { url: state.tabUrl, tabId: state.tabId });
}

/** A press in the results closes an action or plain toast; the scan summary (a status) and an error stay. */
export const closesOnResultsPress = ({ hidden, isStatus, isError }) => !hidden && !isStatus && !isError;

export const clearedText = (count) => `Cleared ${count} ${plural(count, 'card', 'cards')}`;
/** Clear with a lot shown: the toast action label; the popup restores the lot exactly when it is pressed. */
export const CLEARED_TOAST = { label: 'Undo' };

/** The options page's count of remembered cards (it was "N references"). */
export const referencesCountText = (count) => `${count} ${plural(count, 'card', 'cards')} remembered`;

export const fullSizeOfferText = () => 'Some cards are small. Open the full-size photo to read them better.';
export const restoredText = (mins) => `Restored your last scan (${mins < 1 ? 'just now' : `${mins} min ago`}).`;
