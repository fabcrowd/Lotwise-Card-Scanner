import { truncationNote } from "./lib/page-scan.js";
import { confTier, detectedVariant, editionNote, explainScanError, isSetConfirmed, lotValue, modelFileLabel, printingNote, quotedPrice, needsPrinting, fromSeveralPhotos, photoLabel, scanStatus, scanSummary, setRangeSpan, setRangeNote, sourceFooter, splitByRecognition, swapVersion, confirmGuess, readFromSmallCrop, lotCounts, lotEstimate, sureNote, formatUsd, chosenPrintingHasNoPrice, isIdentified, isStale, isSettledRow, staleDays, suggestedVariant, setRangeOf, needsEdition, editionVariant, LOT_EDITIONS } from "./lib/card-display.js";
import { TOO_SMALL_ROW_TEXT } from "./lib/tiny-card.js";
import { DRAW_HINT_TEXT, drawnIndices, isSameLot, placeDrawnCard, replacedKind, restoredLotTabId } from "./lib/draw-box.js";
import { withBoxKind } from "./lib/share-rows.js";
// dev-only:start
import { drawnKind } from "./lib/drawn-examples-store.js";
// dev-only:end
import { ERAS, eraById } from "./lib/era.js";
import { downloadSizeText, missingAssets } from "./lib/setup.js";
import { cropThumb, escHtml, guessOf, guessWithWhy, matchesLabel, renderPickList, renderUnrecognisedGroup, setMenuCorrection, thumbUrl } from "./lib/card-picker.js";
import { ALL_PRICED_TEXT, allPriced, doubleCheckText, pickPrintingHeading, pricedHeading, bulkPairs, bulkRememberedPairs, candidateView, candidatesOfCard, chooseState, confirmLabel, overlayStateOf, renderCandidateCards, renderChooseGroup, renderRemoveButton, renderSkipButton, renderSkippedGroup, renderSkippedRow } from "./lib/choose-flow.js";
import { clearLot, loadLot, saveLot } from "./lib/lot-session.js";
import { leftOutLabel, putBackCard, removeCard, removedCount, skipCard, skippedCount } from "./lib/skip.js";
import { acceptFromBackground, acceptPickSender, acceptRemove } from "./lib/overlay-remove.js";
import { UNREAD_ROW_TEXT, hiddenCount, isNotCard, overlayCards, renderNotCardGroup, renderNotCardRow, shownMessage, showNotCard } from "./lib/not-card.js";
import { finishChips, formatPrinting, renderChipGroup, renderTileStrip, setTiles, versionTiles } from "./lib/option-strip.js";
import { correctedMark, memoryChipHtml, whyHtml } from "./lib/memory-ui.js";
import { userWhy } from "./lib/why.js";
import { bestMatchPrice, isHighValue, priceTypicalOf, unconfirmedTotal } from "./lib/stakes.js";
import { DEFAULT_FILTERS, mergeFilters } from "./lib/price-prefs.js";
import { CONDITION_TIP, conditionName, lotExportLabels, lotExportRows, lotFileName, lotToCsv, lotToTsv } from "./lib/lot-export.js";
import { captionOf, createLoupe } from "./lib/loupe.js";
import { getPptKey } from "./lib/ppt-key.js";
import { loadOverlayShown, saveOverlayShown } from "./lib/overlay-toggle.js";
import { matchPendingFullSize, matchPendingShow, takePendingShow } from "./lib/pending-show.js";
import { stampFinishNote, stampedPrices } from "./lib/set-stamp.js";
import { CHOOSE_VERSION_LABEL, CLEARED_TOAST, HIGH_VALUE_TEXT, NO_PRICE_FOR_VERSION, OPEN_A_LISTING, PAGE_CHANGED_TEXT, VERSION_NOT_PICKED, VERSION_ROW_LABEL, VERSION_SEEN_TEXT, VERSION_SUB, VERSION_TITLE, canRestoreLot, clearedText, closesOnResultsPress, fullSizeOfferText, isUnreadableTabError, nextNotice, notReadReason, pickedVersionLine, restoredText, scanActivityText, scanButtonLabel, scanDisabledReason, scanProgressUpdate, setupProgressText, unconfirmedLine } from "./lib/journey.js";
import { accessOfferText, dismissedFor, hasAllSites, requestAllSites, requestSites, shouldOfferSiteAccess } from "./lib/site-access.js";

const btnScan      = document.getElementById("btn-scan");
const btnClear     = document.getElementById("btn-clear");
const btnDraw      = document.getElementById("btn-draw");
const restoreNote  = document.getElementById("restore-note");
const restoreText  = document.getElementById("restore-text");
const restoreRescan = document.getElementById("restore-rescan");
const btnLabel     = document.getElementById("btn-label");
const btnOptions   = document.getElementById("open-options");
const examStrip    = document.getElementById("exam-strip");
const examYes      = document.getElementById("exam-yes");
const examDismiss  = document.getElementById("exam-dismiss");
const wizStep1     = document.getElementById("wiz-step-1");
const wizStep2     = document.getElementById("wiz-step-2");
const wizStepAccess = document.getElementById("wiz-step-access");
const btnWizAccess  = document.getElementById("btn-wiz-access");
const btnWizAccessSkip = document.getElementById("btn-wiz-access-skip");
const btnWizUpgrade = document.getElementById("btn-wiz-upgrade");
const btnWizSkip    = document.getElementById("btn-wiz-skip");
const sValue       = document.getElementById("s-value");
const statValue    = document.getElementById("stat-value");
const lotTotalsEl  = document.getElementById("lot-totals");
const sCond        = document.getElementById("s-cond");
const lotEditionEl = document.getElementById("lot-edition");
const lotEditionSelect = document.getElementById("lot-edition-select");
const fullSizeNotice = document.getElementById("fullsize-notice");
const fullSizeText = document.getElementById("fullsize-text");
const fullSizeOpen = document.getElementById("fullsize-open");
const resultsEl    = document.getElementById("results");
const emptyHint    = document.getElementById("empty-hint");
const scanStatusEl = document.getElementById("scan-status");
const emptyWhy     = document.getElementById("empty-why");
const msgBar      = document.getElementById("msg-bar");
const setupOverlay = document.getElementById("setup-overlay");
const btnSetup     = document.getElementById("btn-setup");
const setupStatus  = document.getElementById("setup-status");
const setupBars    = document.getElementById("setup-bars");
const setupKeep    = document.getElementById("setup-keep");
const btnSetupRetry = document.getElementById("btn-setup-retry");
const eraSelect    = document.getElementById("era-select");
const overlayShownToggle = document.getElementById("overlay-shown");
const accessNotice  = document.getElementById("access-notice");
const accessText    = document.getElementById("access-text");
const accessOutcome = document.getElementById("access-outcome");
const accessAllow   = document.getElementById("access-allow");
const accessAllowAll = document.getElementById("access-allow-all");
const accessSkip    = document.getElementById("access-skip");
const accessRescan  = document.getElementById("access-rescan");
const bulkPanel     = document.getElementById("bulk-panel");
const bulkList      = document.getElementById("bulk-list");
const bulkConfirm   = document.getElementById("bulk-confirm");
const bulkClose     = document.getElementById("bulk-close");
const bulkCancel    = document.getElementById("bulk-cancel");
const bulkHint      = document.getElementById("bulk-hint");

// Notices (site access, full-size photo, restored lot) show one at a time, access first (11.2): each says whether it is
// wanted, and the first wanted one is the one on screen.
const _noticeWants = { access: false, fullsize: false, restore: false };
// Bumped whenever a scan starts or the lot is replaced: the site-access offer awaits storage and permissions, and an answer
// that arrives after that belongs to a scan that is no longer the one on screen.
let _noticeEpoch = 0;
function syncNotices() {
  const shown = nextNotice(_noticeWants);
  accessNotice.hidden = shown !== "access";
  if (fullSizeNotice) fullSizeNotice.hidden = shown !== "fullsize";
  restoreNote.hidden = shown !== "restore";
}
function setNotice(name, wanted) {
  _noticeWants[name] = wanted;
  syncNotices();
}

const MIN_ART_PX = 20;
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];

let isScanning = false;
let _lastResult = null;
let _scanSeq = 0;
let loupe = null;          // the hover-preview controller, set where createLoupe is called below
let _filters   = mergeFilters(DEFAULT_FILTERS);
let _variantChoice = new Map(); // card index -> printing the user chose, or one settled by the printed number
let _variantSuggest = new Map(); // card index -> printing the picture suggests: preselected, never priced until confirmed
let _variantPicked = new Set(); // card indexes whose printing the user set themselves: the lot edition leaves them alone
let _lotEdition = "";           // the edition applied to every Base Set row not picked individually
let _stripMore = new Set();     // "idx:kind" of the picker strips expanded past their first 8 tiles
let _whyOpen = new Set();       // card indexes whose "Why this card?" text is open
let _changing = new Set();      // priced card indexes whose "Change" reopened the Choose layout (the card stays confirmed until a pick)
let _picker = new Map();        // card index -> { via, query, results } while its search box is open
let _expanded = new Set();      // card indexes of settled priced rows the user opened (never saved: a reopened lot shows them collapsed)
let _showUnrecognised = false;  // the "not recognised" group is open
let _showChoose = true;         // the "To confirm" group is open
let _showSkipped = false;       // the "Skipped" group is open
const _autoSearch = new Map();   // card index -> { card, via, query, results, noMatch }: the open search of a card with no close match
let _showNotCard = false;      // the "Hidden: not a card" group is open (never saved: it opens collapsed)
let _bulk = null;               // { pairs, skipped, opener, scan } while the review-all panel is open
let _searchTimer = null;
let _pickSeq = 0;
const _pickToken = new Map();   // card index -> its latest pick; a slower earlier price is dropped

let _statusTail = "";       // what follows the scan status line: truncation and still-loading notes
let _statusShown = false;   // the message bar currently shows the scan status, so card changes may refresh it

// The message bar is a toast: a plain message fades after 5 s (the text stays in the element), an error stays until the next message.
const TOAST_MS = 5000;
// A toast that offers a way back (Change after a pick, Put back after a skip or a removal) stays longer, and does not fade while hovered or focused.
const TOAST_ACTION_MS = 8000;
let _toastTimer = null;
let _toastAction = null;   // { label, run } of the toast on screen, or null

function startToastTimer() {
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => msgBar.classList.add("fading"), _toastAction ? TOAST_ACTION_MS : TOAST_MS);
}

function showMessage(text, isError = false, isStatus = false, action = null) {
  _statusShown = isStatus;
  _toastAction = text && action ? action : null;
  msgBar.textContent = text;
  if (_toastAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = _toastAction.label;
    msgBar.append(button);
  }
  msgBar.classList.toggle("error", isError);
  msgBar.setAttribute("role", isError ? "alert" : "status");
  msgBar.classList.toggle("hidden", !text);
  clearTimeout(_toastTimer);
  msgBar.classList.remove("fading");
  if (text && !isError) startToastTimer();
}

// The toast's button runs its action once and the toast goes; hovering or focusing an action toast holds it on screen.
msgBar.addEventListener("click", (e) => {
  const button = e.target.closest?.(".toast-action");
  if (!button || !_toastAction) return;
  const { run } = _toastAction;
  showMessage("");
  run();
});
const holdToast = () => { if (_toastAction) { clearTimeout(_toastTimer); msgBar.classList.remove("fading"); } };
const releaseToast = () => { if (_toastAction && !msgBar.matches(":hover, :focus-within") && !msgBar.classList.contains("hidden")) startToastTimer(); };
// Pressing anything in the results list closes the toast first (capture), so it never sits over the next Confirm button;
// whatever that press does may then show its own toast.
document.getElementById("results")?.addEventListener("click", () => {
  if (closesOnResultsPress({ hidden: msgBar.classList.contains("hidden"), isStatus: _statusShown, isError: msgBar.classList.contains("error") })) showMessage("");
}, true);
msgBar.addEventListener("mouseenter", holdToast);
msgBar.addEventListener("focusin", holdToast);
msgBar.addEventListener("mouseleave", releaseToast);
msgBar.addEventListener("focusout", releaseToast);

// Card size: the slider scales every picture through --card-scale on the root. Saved per browser profile.
const CARD_SIZE_MIN = 0.8;
const CARD_SIZE_MAX = 1.6;
const cardSizeInput = document.getElementById("card-size");
function applyCardSize(value) {
  const n = Number(value);
  const size = Number.isFinite(n) ? Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, n)) : 1;
  document.documentElement.style.setProperty("--card-scale", String(size));
  if (cardSizeInput) cardSizeInput.value = String(size);
  return size;
}
try {
  chrome.storage.local.get("cardSize", ({ cardSize }) => applyCardSize(cardSize ?? 1));
} catch { applyCardSize(1); }
cardSizeInput?.addEventListener("input", () => applyCardSize(cardSizeInput.value));
cardSizeInput?.addEventListener("change", () => {
  const size = applyCardSize(cardSizeInput.value);
  try { chrome.storage.local.set({ cardSize: size }); } catch { /* the size still applies for this session */ }
});

async function checkReady() {
  const resp = await chrome.runtime.sendMessage({ action: "checkReady" });
  const ready = Boolean(resp?.ready);
  btnScan.disabled = !ready;
  const tab = ready ? await chrome.runtime.sendMessage({ action: "scanState" }).catch(() => null) : null;
  // No answer from the background says nothing about the tab; only a real answer can call it unreadable.
  showEmptyWhy(ready && !tab ? "" : scanDisabledReason({ ready, tabUrl: tab?.tabUrl, tabId: tab?.tabId }));
  await maybeStartWizard(ready);
  return ready;
}

// The empty state's line under the mark (11.1): why Scan Page cannot run.
function showEmptyWhy(text) {
  emptyWhy.textContent = text;
  emptyWhy.hidden = !text;
}
// The one status line of a scan (11.2), under the Scan button row: shown for every scan, with or without a lot, hidden when it ends.
function showScanStatus(text) {
  scanStatusEl.textContent = text;
  scanStatusEl.hidden = !text;
}
// A scan that failed: the toast says what to do, and an unreadable tab is also said under the empty mark.
function showScanError(message) {
  showMessage(explainScanError(message), true);
  if (isUnreadableTabError(message) || isUnreadableTabError(explainScanError(message))) showEmptyWhy(OPEN_A_LISTING);
}

/* ─── Wizard (first-run flow) ─── */

// Onboarding state: { step: 1 | 'access' | 2 | 'done' }
async function getOnboarding() {
  return new Promise((r) =>
    chrome.storage.sync.get("onboarding", (res) => r(res?.onboarding || { step: 1 })),
  );
}
async function setOnboarding(state) {
  return new Promise((r) => chrome.storage.sync.set({ onboarding: state }, r));
}

function showWizStep(n) {
  wizStep1.classList.toggle("active", n === 1);
  wizStepAccess.classList.toggle("active", n === "access");
  wizStep2.classList.toggle("active", n === 2);
  setupOverlay.style.display = "flex";
}
function hideWizard() { setupOverlay.style.display = "none"; }

/**
 * Decide what to show on popup load:
 *   - models not ready → wizard step 1 (download)
 *   - models ready + onboarding not done + site access not granted or declined → optional site-access step
 *   - models ready + onboarding not done + no PPT key → wizard step 2 (optional upsell)
 *   - otherwise → hidden
 */
async function maybeStartWizard(modelsReady) {
  const onboarding = await getOnboarding();
  const pptApiKey = await getPptKey();
  if (!modelsReady) {
    showWizStep(1);
    // After the step shows, so the size lookup never delays the wizard.
    missingAssets()
      .then((missing) => { document.getElementById("setup-size").textContent = downloadSizeText(missing); })
      .catch((err) => console.warn("[popup] could not size the download", err));
    return;
  }
  if (onboarding.step !== "done" && onboarding.step !== 2 && !(await hasAllSites(chrome.permissions))) {
    showWizStep("access");
    return;
  }
  if (onboarding.step !== "done" && !pptApiKey) {
    showWizStep(2);
    return;
  }
  // Already finished OR already has a key → mark done + skip
  if (onboarding.step !== "done") await setOnboarding({ step: "done" });
  hideWizard();
}

// Download and Retry run the same download; Retry is the one button left after a failure.
async function runSetupDownload() {
  btnSetup.disabled = true;
  btnSetupRetry.hidden = true;
  setupKeep.hidden = false;
  setupStatus.textContent = "Downloading…";
  setupBars.innerHTML = "";
  chrome.runtime.onMessage.addListener(onSetupProgress);
  let resp;
  // A throw (the background went away mid-download) is a failed download like any other: Retry, never a stuck button.
  try { resp = await chrome.runtime.sendMessage({ action: "startSetup" }); } catch (err) { resp = { ok: false, error: err?.message || String(err) }; } finally { chrome.runtime.onMessage.removeListener(onSetupProgress); }
  setupKeep.hidden = true;
  if (resp?.ok) {
    btnScan.disabled = false;
    showEmptyWhy("");
    // The download is over: no "Downloading 5 of 5" may outlive it.
    setupStatus.textContent = "";
    setupBars.innerHTML = "";
    // Move the wizard forward: site access, then the PPT upsell (each skipped when already settled)
    await setOnboarding({ step: "access" });
    await maybeStartWizard(true);
  } else {
    console.error("model download failed", resp?.error || "unknown error");
    setupStatus.textContent = /HTTP 404/.test(String(resp?.error))
      ? "This update isn't available yet. Try again later."
      : "The download stopped. Check your connection and try again.";
    btnSetup.disabled = false;
    btnSetup.hidden = true;
    btnSetupRetry.hidden = false;
    btnSetupRetry.focus();
  }
}
btnSetup.addEventListener("click", runSetupDownload);
btnSetupRetry.addEventListener("click", runSetupDownload);

btnWizAccess.addEventListener("click", async () => {
  // The permission prompt is allowed only when asked for straight from this click.
  await requestAllSites(chrome.permissions);
  await setOnboarding({ step: 2 });
  await maybeStartWizard(true);
});

btnWizAccessSkip.addEventListener("click", async () => {
  await setOnboarding({ step: 2 });
  await maybeStartWizard(true);
});

btnWizUpgrade.addEventListener("click", async () => {
  // Open signup + settings — user comes back when they're done
  chrome.tabs.create({ url: "https://www.pokemonpricetracker.com/api-keys" });
  chrome.runtime.openOptionsPage();
  await setOnboarding({ step: "done" });
  hideWizard();
});

btnWizSkip.addEventListener("click", async () => {
  await setOnboarding({ step: "done" });
  hideWizard();
});

function onSetupProgress(msg) {
  if (msg.action !== "setupProgress") return;
  const { file, fileIndex, fileDone, totalFiles, bytesLoaded, bytesTotal } = msg;
  const pct = bytesTotal > 0 ? Math.round((bytesLoaded / bytesTotal) * 100) : 0;
  const label = modelFileLabel(file);
  setupStatus.textContent = setupProgressText(fileIndex, totalFiles, pct);
  let bar = document.getElementById(`bar-${fileIndex}`);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = `bar-${fileIndex}`;
    bar.className = "setup-file";
    bar.innerHTML = `<span class="setup-file-name">${escHtml(label)}</span>
      <div class="setup-file-track"><div class="setup-file-fill" id="fill-${fileIndex}"></div></div>
      <span class="setup-file-pct" id="pct-${fileIndex}">0%</span>`;
    setupBars.appendChild(bar);
  }
  document.getElementById(`fill-${fileIndex}`).style.width = pct + "%";
  document.getElementById(`pct-${fileIndex}`).textContent   = pct + "%";
  if (fileDone) {
    document.getElementById(`fill-${fileIndex}`).style.width = "100%";
    document.getElementById(`pct-${fileIndex}`).textContent   = "✓";
  }
}

/* ─── Options page ─── */

btnOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

/* ─── Scan page ─── */

btnScan.addEventListener("click", scanPage);

/* ─── Era ─── */

for (const era of ERAS) eraSelect.add(new Option(era.label, era.id));
chrome.storage.local.get("scanEra", ({ scanEra }) => {
  if (eraById(scanEra)) eraSelect.value = scanEra;
});
eraSelect.addEventListener("change", () => {
  chrome.storage.local.set({ scanEra: eraSelect.value });
  if (_lastResult && !isScanning) scanPage();
});

/* ─── Show boxes on page ─── */

// An overlay pushed before the stored choice is read would show boxes the user turned off.
const overlayShownLoaded = loadOverlayShown(chrome.storage.local).then((shown) => { overlayShownToggle.checked = shown; });
overlayShownToggle.addEventListener("change", () => {
  saveOverlayShown(chrome.storage.local, overlayShownToggle.checked).catch(() => {});
  chrome.runtime.sendMessage({ action: "setOverlayShown", shown: overlayShownToggle.checked }).catch(() => {});
});

// Clear with a lot shown can be taken back for the toast's 8 s: the lot is kept as it was, in memory, and put back whole.
function takeLotSnapshot() {
  return {
    lastResult: _lastResult, lotUrl: _lotUrl, lotTabId: _lotTabId, lotEdition: _lotEdition,
    variantChoice: _variantChoice, variantSuggest: _variantSuggest, variantPicked: _variantPicked,
    picker: _picker, changing: _changing, whyOpen: _whyOpen, stripMore: _stripMore, expanded: _expanded,
    showUnrecognised: _showUnrecognised, showSkipped: _showSkipped, showChoose: _showChoose, showNotCard: _showNotCard, userEdits: _userEdits,
  };
}

function restoreLotSnapshot(snap) {
  resetLotUiState();
  _lastResult = snap.lastResult; _lotUrl = snap.lotUrl; _lotTabId = snap.lotTabId; _lotEdition = snap.lotEdition;
  _variantChoice = snap.variantChoice; _variantSuggest = snap.variantSuggest; _variantPicked = snap.variantPicked;
  _picker = snap.picker; _changing = snap.changing; _whyOpen = snap.whyOpen; _stripMore = snap.stripMore; _expanded = snap.expanded;
  _showUnrecognised = snap.showUnrecognised; _showSkipped = snap.showSkipped; _showChoose = snap.showChoose; _showNotCard = snap.showNotCard; _userEdits = snap.userEdits;
  updateStats(_lastResult.cards);
  renderResults();
  pushOverlay();
  scheduleSave();
  refreshStatus(true);
  // A price that was still loading when the lot was cleared was dropped as stale: ask again, the way a pick does.
  _lastResult.cards.forEach((card, idx) => {
    if (card.pricing === true && card.identity?.id) pickSet(idx, card.identity.id, card.setChoices?.length ? null : card.identity);
  });
}

// Undo works only where the lot came from: the same page and tab. The background knows the page the scanner is on now.
async function undoClear(snap) {
  if (_lastResult) return;
  const state = await chrome.runtime.sendMessage({ action: "scanState" }).catch(() => null);
  if (_lastResult) return; // a scan started while this was asked
  if (!canRestoreLot({ url: snap.lotUrl, tabId: snap.lotTabId }, state)) { showMessage(PAGE_CHANGED_TEXT); return; }
  restoreLotSnapshot(snap);
}

btnClear.addEventListener("click", () => {
  const snap = _lastResult?.cards?.length ? takeLotSnapshot() : null;
  const clearedCount = snap ? lotCounts(snap.lastResult.cards).found || snap.lastResult.cards.length : 0;
  chrome.runtime.sendMessage({ action: "clearPageOverlay" }).catch(() => {});
  clearTimeout(_saveTimer);
  clearLot(lotArea(), _lotUrl).catch(() => {});
  _noticeEpoch += 1;
  setNotice("restore", false);
  setNotice("access", false);
  _lastResult = null;
  resetLotUiState();
  _lotTabId = null;
  _variantChoice = new Map();
  _variantSuggest = new Map();
  _variantPicked = new Set();
  _lotEdition = "";
  _stripMore = new Set();
  _showUnrecognised = false;
  _showSkipped = false;
  _showChoose = true;
  closeBulk(false);
  examStrip.hidden = true;
  resetResults();
  updateScanLabel();
  showMessage("");
  if (!snap) return;
  // Undo does nothing once something else (a new scan) has replaced the empty list.
  showMessage(clearedText(clearedCount), false, false, { label: CLEARED_TOAST.label, run: () => undoClear(snap) });
});

// "Scan again" once a lot is shown (11.2).
function updateScanLabel() {
  btnLabel.textContent = scanButtonLabel({ scanning: isScanning, hasLot: Boolean(_lastResult?.cards?.length) });
}

// `status`: the first words of the status line. The tab the scan reads is learned from the background, so a progress message
// from another tab's scan is not taken for this one.
let _scanTabId = null;
function beginScanUi(status = scanActivityText(0)) {
  isScanning = true;
  _noticeEpoch += 1;
  _scanTabId = null;
  btnScan.classList.add("scanning");
  updateScanLabel();
  showEmptyWhy("");
  showScanStatus(status);
  btnScan.disabled = true;
  btnScan.setAttribute("aria-busy", "true");
  eraSelect.disabled = true;
  for (const name of ["access", "restore", "fullsize"]) _noticeWants[name] = false;
  syncNotices();
  showMessage("");
  chrome.runtime.onMessage.addListener(onScanProgress);
  Promise.resolve(chrome.runtime.sendMessage({ action: "scanState" })).then((state) => {
    if (isScanning && Number.isInteger(state?.tabId)) _scanTabId = state.tabId;
  }).catch(() => {});
}

async function scanPage() {
  if (isScanning) return;
  beginScanUi();

  let data;
  try {
    data = await chrome.runtime.sendMessage({ action: "scanPage", era: eraSelect.value || null });
  } catch (err) {
    finishScan();
    showScanError(err?.message || err);
    return;
  }

  if (!data || data.error) {
    finishScan();
    showScanError(data?.error || "Scan didn't finish. Try again.");
    return;
  }

  applyScanResult(data);
  finishScan();
}

// A scan's result in the list, the stats and the page overlay. A rescan the page started (pictures that loaded
// later) comes here too, so the list always matches what the overlay shows.
function applyScanResult(data) {
  _noticeEpoch += 1;
  setNotice("restore", false);
  if (data.tabUrl) _lotUrl = data.tabUrl;
  if (Number.isInteger(data.targetTabId) || Number.isInteger(data.tabId)) _lotTabId = data.targetTabId ?? data.tabId;
  const cards = (data.cards || []).map((card) => ({ ...card, guess: guessOf(card) }));
  _lastResult = { scanId: ++_scanSeq, bgScanId: data.scanId, cards, srcWidth: data.srcWidth, srcHeight: data.srcHeight,
    fullSize: data.fullSizePhoto?.url ? data.fullSizePhoto : null };
  resetLotUiState();
  _variantChoice = new Map();
  _variantSuggest = new Map();
  _variantPicked = new Set();
  _lotEdition = "";
  _stripMore = new Set();
  _userEdits = false;
  _showUnrecognised = false;
  _showChoose = true;
  closeBulk(false);
  _lastResult.cards.forEach(seedVariant);
  // Offered only to someone who opted in, on a photo picked for checking; it never blocks anything.
  examStrip.hidden = data.shareExam !== true;
  updateStats(_lastResult.cards);
  renderResults();
  maybeOfferSiteAccess(data).catch(() => { setNotice("access", false); });
  showFullSizeOffer(_lastResult.fullSize);

  if (cards.length === hiddenCount(cards)) {
    showMessage("No Pokémon cards detected on this page.");
  } else {
    const stillLoading = data.pending > 0
      ? ` ${data.pending} picture${data.pending === 1 ? " is" : "s are"} still loading.`
      : "";
    _statusTail = `${truncationNote(data.truncated)}.${stillLoading}`;
    refreshStatus(true);
  }

  // Push the overlay snapshot with current filter state baked in
  pushOverlay();
  loadBestMatchPrices(_lastResult);
}

// The top status line always counts the cards as they are now. A pick's own message ("Getting price...") replaces it
// until the next scan; while the status is showing, every change to the cards (a pick) refreshes it.
function refreshStatus(force = false) {
  const cards = _lastResult?.cards;
  if (!cards?.length || !(force || _statusShown)) return;
  showMessage(`${scanSummary(cards)}${_statusTail}`, false, true);
}

/* ─── Best-match prices: the price of the card a Choose row would confirm (lib/stakes.js) ─── */

// One priceCard call per Choose card, for its preselected best match only, a few at a time, cached by candidate id. The
// answer is shown marked unconfirmed; it never confirms anything. A pick reuses the same answer.
const STAKES_FETCH_LIMIT = 6;
const _candidatePrice = new Map();
const _candidateResp = new Map();   // candidate id -> priceCard answer, once loaded
const _candidateFailed = new Set(); // candidate ids whose price could not be fetched: shown as "no price"
const _stakesQueue = [];
let _stakesActive = 0;

function limitedFetch(task) {
  return new Promise((resolve) => {
    const run = async () => {
      _stakesActive += 1;
      try { resolve(await task()); } finally {
        _stakesActive -= 1;
        _stakesQueue.shift()?.();
      }
    };
    if (_stakesActive < STAKES_FETCH_LIMIT) run(); else _stakesQueue.push(run);
  });
}

function candidatePrice(id) {
  if (!_candidatePrice.has(id)) {
    const asked = limitedFetch(async () => {
      try { return await chrome.runtime.sendMessage({ action: "priceCard", id }); } catch (err) { return { error: explainScanError(err?.message || err) }; }
    }).then((resp) => {
      if (!resp || resp.error) _candidatePrice.delete(id); else _candidateResp.set(id, resp);
      if (!resp || resp.error) _candidateFailed.add(id); else _candidateFailed.delete(id);
      return resp;
    });
    _candidatePrice.set(id, asked);
  }
  return _candidatePrice.get(id);
}

function bestCandidateOf(card) { return candidatesOfCard(card)[0] || null; }

// The best match's price for a Choose card, or null while it is loading (or the card has no candidate).
function matchPriceOf(card) {
  const best = bestCandidateOf(card);
  if (!best?.id) return null;
  if (_candidateFailed.has(best.id) && !_candidateResp.has(best.id)) return { price: null, kind: "none", stale: false, failed: true };
  return bestMatchPrice(card, _candidateResp.get(best.id), enabledConditions());
}

// The typical price used for the high-value flag: the best match's for a Choose card, the card's own once confirmed.
function typicalForFlag(card, idx) {
  if (chooseState(card) === "choose") {
    const match = matchPriceOf(card);
    return match && !match.stale ? match.price : null;
  }
  return isStale(card) ? null : priceTypicalOf(card, chosenPrinting(card, idx), enabledConditions());
}

function highValueChipHtml(card, idx) {
  return isHighValue(card, typicalForFlag(card, idx))
    ? ` <span class="value-chip" title="This card is worth enough to be worth a second look. It is not marked confirmed because of its price.">${escHtml(HIGH_VALUE_TEXT)}</span>`
    : "";
}

// A price arriving re-renders the rows; a keyboard user's focus stays on the same button of the same row.
const FOCUS_KEYS = ["data-confirm-best", "data-pick", "data-skip-card", "data-open-search", "data-show-on-page", "data-put-back"];
function renderKeepingFocus() {
  const active = document.activeElement;
  const inList = resultsEl.contains(active);
  const key = inList ? FOCUS_KEYS.find((name) => active.hasAttribute(name)) : null;
  const idx = inList ? active.closest(".card-row[data-idx]")?.dataset.idx : null;
  const pick = key === "data-pick" ? active.getAttribute("data-pick") : null;
  renderResults();
  if (!key || idx == null) return;
  const same = [...resultsEl.querySelectorAll(`.card-row[data-idx="${idx}"] [${key}]`)].find((el) => !pick || el.getAttribute(key) === pick);
  same?.focus({ preventScroll: true });
}

function loadBestMatchPrices(scan) {
  let refreshQueued = false;
  const refresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    Promise.resolve().then(() => {
      refreshQueued = false;
      if (_lastResult?.scanId !== scan.scanId || _picker.size) return;
      renderKeepingFocus();
      updateStats(_lastResult.cards);
      pushOverlay();
    });
  };
  scan.cards.forEach((card) => {
    if (chooseState(card) !== "choose") return;
    const best = bestCandidateOf(card);
    if (!best?.id) return;
    if (_candidateResp.has(best.id)) { refresh(); return; }
    candidatePrice(best.id).then(refresh);
  });
}

// The background rescans on its own when more card pictures load. A pick in progress is never thrown away: the list
// and overlay stay as they are and the user is told to scan again.
let _userEdits = false;
resultsEl.addEventListener("change", () => { _userEdits = true; }, true);
resultsEl.addEventListener("click", (e) => { if (e.target?.closest?.("button, select, a, input")) _userEdits = true; }, true);
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!acceptFromBackground(sender, chrome.runtime.id)) return;
  if (msg?.action !== "rescanResult" || !msg.data || isScanning) return;
  if (_picker.size || _userEdits) {
    pushOverlay();
    showMessage("More cards loaded on the page. Scan again to add them.");
    return;
  }
  applyScanResult(msg.data);
});

/* ─── Draw a box: a card the scan missed ─── */

// The page enters draw mode; when the user has drawn, the background reads the box and sends the card back as "drawnCard".
let _drawPending = false;   // draw mode is on in the page and no box has come back yet

// The header crosshair is a toggle: pressed while the page is in draw mode, and pressing it again leaves draw mode.
function setDrawPending(on) {
  _drawPending = on;
  btnDraw.setAttribute("aria-pressed", String(on));
}
btnDraw.setAttribute("aria-pressed", "false");

async function startDrawBox() {
  if (isScanning) { showMessage("Wait for the scan to finish, then draw a box.", true); return; }
  try {
    const resp = await chrome.runtime.sendMessage({ action: "drawBox", era: eraSelect.value || null });
    if (resp?.error) { showMessage(resp.error, true); return; }
    setDrawPending(true);
    showMessage(DRAW_HINT_TEXT);
  } catch (err) {
    showMessage(explainScanError(err?.message || err), true);
  }
}

function cancelDrawBox() {
  setDrawPending(false);
  chrome.runtime.sendMessage({ action: "cancelDraw" }).catch(() => {});
  showMessage("");
}
btnDraw.addEventListener("click", () => (_drawPending ? cancelDrawBox() : startDrawBox()));

// Closing the popup with a draw pending leaves the page's draw mode too (best effort: the page also leaves it on its own).
window.addEventListener("pagehide", () => {
  if (_drawPending) chrome.runtime.sendMessage({ action: "cancelDraw" }).catch(() => {});
});

// The drawn card joins the list (replacing a hidden or Too small entry it covers) and the page overlay, as a Choose or
// confirmed row by the usual rules; drawing confirms nothing. With no scan yet it starts a one-card result.
// dev-only:start
// Tells the background what the drawn box turned out to be, for the training log. Best effort: never in the way of the list.
function reportDrawnKind(msg, replacedCard) {
  if (typeof msg.exampleId !== "string") return;
  chrome.runtime.sendMessage({ action: "drawnPlaced", exampleId: msg.exampleId, kind: drawnKind(replacedCard) }).catch(() => {});
}
// dev-only:end

// A box signal for the relay, when sharing is on (the background decides). Never in the way of what the user did.
function sendBoxSignal(source, scanId, index, card) {
  chrome.runtime.sendMessage({ action: "shareBoxSignal", source, scanId: scanId ?? null, index, ...drawnFields(card) }).catch(() => {});
}

function applyDrawnCard(msg) {
  setDrawPending(false);
  const drawn = { ...msg.card, guess: guessOf(msg.card) };
  // The kind of box it was (the scan had hidden, Too small or nothing there) is known only here.
  const withKind = (replacedCard) => (drawn.share ? { ...drawn, share: withBoxKind(drawn.share, replacedKind(replacedCard)) } : drawn);
  let card = withKind(null);
  // A result from another page is not added to: the drawn card starts its own one-card result, so the overlay and totals never mix pages.
  // Two tabs on the same URL are two lots, so the tab counts too.
  if (!_lastResult || !isSameLot({ url: _lotUrl, tabId: _lotTabId }, { url: msg.tabUrl, tabId: msg.tabId })) {
    applyScanResult({ cards: [card], srcWidth: msg.srcWidth, srcHeight: msg.srcHeight, tabUrl: msg.tabUrl, tabId: msg.tabId, scanId: null });
    sendBoxSignal("drawn", null, 0, card);
    // dev-only:start
    reportDrawnKind(msg, null);
    // dev-only:end
    return;
  }
  const placed = placeDrawnCard(_lastResult.cards, drawn);
  card = withKind(placed.replacedCard);
  const cards = placed.cards.map((c, i) => (i === placed.index ? card : c));
  sendBoxSignal("drawn", _lastResult.bgScanId, placed.index, card);
  // dev-only:start
  reportDrawnKind(msg, placed.replacedCard);
  // dev-only:end
  _lastResult = { ..._lastResult, cards };
  for (const map of [_variantChoice, _variantSuggest]) map.delete(placed.index);
  _variantPicked.delete(placed.index);
  seedVariant(card, placed.index);
  _showChoose = true;
  updateStats(cards);
  renderResults();
  loadBestMatchPrices(_lastResult);
  pushOverlay();
  showMessage(`Box ${placed.index + 1} added${card.tooSmall ? ": too small to read" : card.cardBack ? ": it reads as a card back" : ""}.`);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!acceptFromBackground(sender, chrome.runtime.id)) return;
  if (msg?.action === "drawnCard" && msg.card) applyDrawnCard(msg);
  else if (msg?.action === "drawnFailed") { setDrawPending(false); showMessage(typeof msg.error === "string" ? msg.error : "Could not read that box.", true); }
});

// The page left draw mode itself (Esc, its Cancel button, the page going away): the crosshair is no longer pressed, and the hint goes.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.action !== "drawEnded" || !_drawPending) return;
  if (!acceptPickSender(sender, chrome.runtime.id, _lotUrl)) return;
  setDrawPending(false);
  if (msgBar.textContent === DRAW_HINT_TEXT) showMessage("");
});

/* ─── Site access offer ─── */

// The site the offer is about, and the origins "Allow" asks for: the page and the hosts of the photos it could not read.
let _accessOffer = { site: "", origins: [] };

async function maybeOfferSiteAccess(scan) {
  const epoch = _noticeEpoch;
  const { siteAccessDismissedAt, siteAccessDismissed } = await chrome.storage.local.get(["siteAccessDismissedAt", "siteAccessDismissed"]);
  const now = Date.now();
  const site = typeof scan?.accessSite === "string" ? scan.accessSite : "";
  const dismissed = dismissedFor({ site, dismissedSites: siteAccessDismissed, dismissedAt: siteAccessDismissedAt, now });
  const offer = shouldOfferSiteAccess({ scan, hasAll: await hasAllSites(chrome.permissions), dismissedAt: dismissed ? now : undefined, now });
  if (epoch !== _noticeEpoch) return; // a newer scan or lot took over while this one waited
  _accessOffer = { site, origins: Array.isArray(scan?.accessOrigins) ? scan.accessOrigins : [] };
  accessText.textContent = accessOfferText({ site, galleryUnread: Number(scan?.galleryUnread) || 0 });
  accessText.hidden = false;
  accessOutcome.textContent = "";
  const oneSite = Boolean(site) && _accessOffer.origins.length > 0;
  accessAllow.textContent = oneSite ? `Allow on ${site}` : "Allow";
  accessAllow.hidden = false;
  accessAllowAll.hidden = !oneSite;
  accessSkip.hidden = false;
  accessRescan.hidden = true;
  setNotice("access", Boolean(offer));
}

async function dismissAccessOffer() {
  const { siteAccessDismissed } = await chrome.storage.local.get("siteAccessDismissed");
  if (!_accessOffer.site) return chrome.storage.local.set({ siteAccessDismissedAt: Date.now() });
  return chrome.storage.local.set({ siteAccessDismissed: { ...(siteAccessDismissed || {}), [_accessOffer.site]: Date.now() } });
}

function accessGranted() {
  accessText.hidden = true;
  accessAllow.hidden = true;
  accessAllowAll.hidden = true;
  accessSkip.hidden = true;
  accessOutcome.textContent = "Done — scan again to read the original photos";
  accessRescan.hidden = false;
  accessRescan.focus();
}

// Must run straight from the click: the browser refuses a permission request made later.
accessAllow.addEventListener("click", async () => {
  // Called first thing in the click, before any other await: the browser refuses a request made later.
  const granted = _accessOffer.site && _accessOffer.origins.length
    ? await requestSites(chrome.permissions, _accessOffer.origins)
    : await requestAllSites(chrome.permissions);
  if (!granted) {
    dismissAccessOffer().catch(() => {});
    setNotice("access", false);
    return;
  }
  accessGranted();
});
accessAllowAll.addEventListener("click", async () => {
  if (!(await requestAllSites(chrome.permissions))) return;
  accessGranted();
});
accessSkip.addEventListener("click", () => {
  dismissAccessOffer().catch(() => {});
  setNotice("access", false);
  btnScan.focus();
});
accessRescan.addEventListener("click", () => {
  setNotice("access", false);
  scanPage();
});

function onScanProgress(msg, sender) {
  if (!acceptFromBackground(sender, chrome.runtime.id)) return;
  const update = scanProgressUpdate(msg, _scanTabId);
  if (update) showScanStatus(update.activity);
}

function finishScan() {
  chrome.runtime.onMessage.removeListener(onScanProgress);
  isScanning = false;
  btnScan.classList.remove("scanning");
  showScanStatus("");
  updateScanLabel();
  btnScan.disabled = false;
  btnScan.setAttribute("aria-busy", "false");
  eraSelect.disabled = false;
}

/* ─── Filters ─── */

function loadFilters() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("filters", (res) => {
      _filters = mergeFilters(res?.filters);
      resolve();
    });
  });
}

// Filters are edited on the Settings page; a change there shows up here without a rescan.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.filters) return;
  _filters = mergeFilters(changes.filters.newValue);
  if (!_lastResult) return;
  renderResults();
  updateStats(_lastResult.cards);
  pushOverlay();
});

function enabledConditions() { return CONDITIONS.filter((c) => _filters.raw[c]); }
function enabledGraders()    { return Object.keys(_filters.graded).filter((g) => _filters.graded[g]); }

/* ─── Stats + results ─── */

function updateStats(cards) {
  const choiceFor = (card) => _variantChoice.get(cards.indexOf(card)) || null;
  const lot = lotValue(cards, choiceFor, enabledConditions());
  sValue.textContent = lot.value ?? "—";
  setStatDetail(lot.detail);
  sCond.textContent = enabledConditions()[0] || "NM";
  sCond.hidden = false;
  renderLotTotals(cards, choiceFor);
  renderLotEdition(cards);
}

for (const edition of LOT_EDITIONS) lotEditionSelect.add(new Option(edition.label, edition.id));

// Shown only while some row has its finish settled by the printed number but its edition open.
function renderLotEdition(cards) {
  lotEditionEl.hidden = !(cards || []).some(needsEdition);
  lotEditionSelect.value = _lotEdition;
}

// One edition for the whole lot: every eligible row the user has not set themselves takes it, or loses it when cleared.
lotEditionSelect.addEventListener("change", () => {
  const cards = _lastResult?.cards;
  if (!cards) return;
  _lotEdition = lotEditionSelect.value;
  cards.forEach((card, idx) => {
    if (_variantPicked.has(idx) || !needsEdition(card)) return;
    const key = _lotEdition ? editionVariant(card, _lotEdition) : null;
    if (key) _variantChoice.set(idx, key);
    else _variantChoice.delete(idx);
    _variantSuggest.delete(idx);
  });
  renderResults();
  pushOverlay();
  updateStats(cards);
  lotEditionSelect.focus();
});

// The lot in two figures: what the confirmed cards are worth (a range while a printing is open), and how many
// cards are still to confirm. A guessed card adds nothing until the user confirms it.
function renderLotTotals(cards, choiceFor) {
  if (!lotTotalsEl) return;
  const list = (cards || []).filter((card) => !card.cardBack);
  if (!list.length) { lotTotalsEl.hidden = true; return; }
  const skipped = skippedCount(cards);
  const removed = removedCount(cards);
  const t = lotEstimate(cards, choiceFor, enabledConditions());
  const span = (low, high) => (Math.abs(high - low) < 0.005 ? formatUsd(high) : `${formatUsd(low)}–${formatUsd(high)}`);
  const cond = enabledConditions()[0] || "NM";
  const note = sureNote(t);
  const labels = lotExportLabels(...currentLotCounts(cards, choiceFor));
  const counts = lotCounts(cards);
  const actions = labels
    ? `<span class="lt-actions" title="${escHtml(labels.tip)}">`
      + `<button type="button" class="lt-btn" data-lot-copy aria-label="${escHtml(labels.copy)}" title="${escHtml(labels.tip)}">${escHtml(labels.copy)}</button>`
      + `<button type="button" class="lt-btn" data-lot-csv aria-label="${escHtml(labels.csv)}" title="${escHtml(labels.tip)}">${escHtml(labels.csv)}</button></span>`
    : "";
  const unconfirmed = unconfirmedTotal(cards, (card) => matchPriceOf(card));
  const hadCopyFocus = lotTotalsEl.contains(document.activeElement) ? document.activeElement.closest("[data-lot-copy], [data-lot-csv]") : null;
  const flags = cards.filter((card, idx) => splitByRecognition(cards).shown.includes(idx) && needsDoubleCheck(card, idx)).length;
  const done = allPriced(cards, needsDoubleCheck) ? `<span class="lt-done"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${escHtml(ALL_PRICED_TEXT)}</span>` : flags ? `<span class="lt-check">${escHtml(doubleCheckText(flags))}</span>` : "";
  lotTotalsEl.innerHTML = `<span class="lt-item"><span class="lt-lbl">Confirmed value</span> <b>${escHtml(span(t.low, t.high))}</b> <span class="lt-n"${note.title ? ` title="${escHtml(note.title)}"` : ""}>${escHtml(note.text)}</span> <span class="lt-cond" title="${escHtml(CONDITION_TIP)}">${escHtml(conditionName(cond))}</span>${done}</span>`
    + `<span class="lt-item lt-guess" title="${escHtml(`${scanStatus(cards)}. Cards still to confirm. Confirm each card to see its price.`)}"><span class="lt-lbl">To confirm</span> <b>${counts.toConfirm}</b></span>`
    + (counts.toPick ? `<span class="lt-item lt-versions" title="Cards whose name is sure but whose version is still open. Pick the version to get one price."><span class="lt-lbl">Versions to pick</span> <b>${counts.toPick}</b></span>` : "")
    + (unconfirmed.count ? `<span class="lt-item lt-unconfirmed" title="Best-match prices of the cards still to confirm. Not part of Confirmed value or the export.">${escHtml(unconfirmedLine(unconfirmed.count, unconfirmed.total))}</span>` : "")
    + (skipped ? `<span class="lt-item lt-skipped" title="${escHtml(removed === skipped ? "Cards you removed from the scan. They are not counted, priced or exported." : removed ? "Cards you skipped or removed. They are not counted, priced or exported." : "Cards you skipped. They are not priced or exported.")}"><span class="lt-lbl">${escHtml(leftOutLabel(skipped, removed))}</span> <b>${skipped}</b></span>` : "")
    + actions;
  lotTotalsEl.hidden = false;
  // The strip is rewritten on every card change; a keyboard user on Copy or Download stays on it.
  if (hadCopyFocus) lotTotalsEl.querySelector(hadCopyFocus.hasAttribute("data-lot-csv") ? "[data-lot-csv]" : "[data-lot-copy]")?.focus();
}

// Copy and Download write only the confirmed cards, on the user's click; nothing leaves the browser otherwise.
function currentLot() {
  const cards = _lastResult?.cards || [];
  const choiceFor = (card) => _variantChoice.get(cards.indexOf(card)) || null;
  return lotExportRows(cards, choiceFor, enabledConditions());
}
function currentLotCounts(cards, choiceFor) {
  const { count, notIncluded, skipped, removed, total } = lotExportRows(cards, choiceFor, enabledConditions());
  return [count, notIncluded, skipped, removed, total];
}

// The clipboard API needs no extra permission from a click; the textarea route is for when it refuses.
function copyWithTextarea(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { area.remove(); }
}

async function copyLot() {
  const lot = currentLot();
  const labels = lotExportLabels(lot.count, lot.notIncluded, lot.skipped, lot.removed, lot.total);
  if (!labels) return;
  const text = lotToTsv(lot.rows);
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = copyWithTextarea(text);
  }
  showMessage(copied ? labels.copied : "Copy failed: use Download CSV", !copied);
}

function downloadLot() {
  const lot = currentLot();
  const labels = lotExportLabels(lot.count, lot.notIncluded, lot.skipped, lot.removed);
  if (!labels) return;
  const name = lotFileName(new Date());
  // The byte order mark makes Excel read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(["﻿", lotToCsv(lot.rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showMessage(`Saved ${lot.count} ${lot.count === 1 ? "card" : "cards"} as ${name}`);
}

lotTotalsEl?.addEventListener("click", (event) => {
  if (event.target.closest("[data-lot-copy]")) copyLot();
  else if (event.target.closest("[data-lot-csv]")) downloadLot();
});

/* ─── Full-size photo offer ─── */

// The scan found the photo's cards small and knows a larger rendition it could not read itself (no site access, or
// the fetch failed). Opening it in a tab lets the next scan read it; the popup scans it as soon as it has loaded.
let _fullSizeTabId = null;
function showFullSizeOffer(offer) {
  if (!fullSizeNotice) return;
  if (!offer?.url) { setNotice("fullsize", false); return; }
  fullSizeText.textContent = fullSizeOfferText();
  fullSizeOpen.dataset.url = offer.url;
  setNotice("fullsize", true);
}

// The offer's button and the page's pill both come here: site access, then a new tab, then the scan once it has loaded.
fullSizeOpen?.addEventListener("click", () => openFullSizePhoto());

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.action !== "overlayFullSize") return;
  if (!acceptPickSender(sender, chrome.runtime.id, _lotUrl)) return;
  openFullSizePhoto({ fromPage: true });
});

// `fromPage`: the page's pill, which is not a click in this window. With site access already given the whole path runs; without
// it the browser would refuse a request that has no click behind it, so the offer's own button is shown and focused for the user to press.
async function openFullSizePhoto({ fromPage = false } = {}) {
  const offer = _lastResult?.fullSize;
  if (!offer?.url) return;
  let origin = null;
  try { origin = new URL(offer.url).origin + "/*"; } catch { return; }
  const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
  if (!granted && fromPage) {
    showFullSizeOffer(offer);
    fullSizeOpen.focus();
    return;
  }
  // Asked straight from the click, which the browser requires: without access the new tab cannot be scanned.
  const allowed = granted || await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  const tab = await chrome.tabs.create({ url: offer.url, active: true }).catch(() => null);
  setNotice("fullsize", false);
  if (!tab) return;
  _fullSizeTabId = tab.id;
  showMessage(allowed ? "Opening the full-size photo — it is scanned when it has loaded." : "Opened the full-size photo. Press Scan Page there.");
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== _fullSizeTabId || info.status !== "complete") return;
  _fullSizeTabId = null;
  // The background follows the active tab while this window is open, so the scan reads the new tab.
  setTimeout(() => { if (!isScanning) scanPage(); }, 600);
});

// The open state of each collapsible group, by the id of its list.
const GROUP_OPEN = {
  "choose-list": () => { _showChoose = true; },
  "unrec-list": () => { _showUnrecognised = true; },
  "skipped-list": () => { _showSkipped = true; },
  "notcard-list": () => { _showNotCard = true; },
};

// The control a card's row offers first: the Best match tile of a Choose card, Confirm on a row reopened by Change,
// a card whose printing is open its first printing tile, otherwise its Change button.
function firstControlOf(row) {
  const check = row.querySelector("[data-confirm-match]");
  if (check) return check;
  const card = _lastResult?.cards?.[Number(row.dataset.idx)];
  if (card && !row.classList.contains("choose-row") && needsPrinting(card)) {
    const tile = row.querySelector("[data-strip-pick]");
    if (tile) return tile;
  }
  if (row.classList.contains("changing")) return row.querySelector("[data-confirm-best]");
  if (row.classList.contains("choose-row")) {
    return row.querySelector("button[data-pick]") || row.querySelector("[data-confirm-best]") || row.querySelector("[data-open-search]");
  }
  // A skipped, hidden or unrecognised row: its way back (Put back, Show it), else its first button.
  if (row.classList.contains("unrec-row")) return row.querySelector("[data-put-back], [data-show-hidden]") || row.querySelector("button");
  return row.querySelector(".change-btn[data-open-search]") || row.querySelector("[data-open-search]");
}

// A click on a card on the page (or a stored one for a window it just opened): that card's row, ready to act on.
function showCardInScanner(index) {
  // A settled card's row is one line: the click on the page opens it (hovering only highlights it).
  if (resultsEl.querySelector(`.card-row.is-collapsed[data-idx="${index}"]`)) { _expanded.add(index); renderResults(); }
  let row = resultsEl.querySelector(`.card-row[data-idx="${index}"]`);
  const group = row?.closest("[hidden]");
  if (group && GROUP_OPEN[group.id]) { GROUP_OPEN[group.id](); renderResults(); row = resultsEl.querySelector(`.card-row[data-idx="${index}"]`); }
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  row.classList.add("flash");
  setTimeout(() => row.classList.remove("flash"), 1600);
  showDock(row);
  firstControlOf(row)?.focus({ preventScroll: true });
  highlightOnPage(index);
}

// The page sends this to every extension page; an open window shows the card here. A window the click opened reads the
// background's stored index instead (see the init at the end).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.action !== "overlayPick" || !Number.isInteger(msg.index)) return;
  // From the background, or from a content script in a top frame of this lot's page; the background does not relay it, so no card is shown twice.
  if (!acceptPickSender(sender, chrome.runtime.id, _lotUrl)) return;
  showCardInScanner(msg.index);
  // The background stored the same index for a window it might have to open; this window showed it, so it is used up.
  takePendingShow(chrome.storage.session).catch(() => {});
});

// A catalog picture that fails to load (offline, 404) becomes a neutral tile with the card's name, never the browser's
// broken-image icon. The error does not bubble, so it is caught on the way down.
resultsEl.addEventListener("error", (e) => {
  const img = e.target;
  // A collapsed row's stock picture that will not load gives way to the page crop, so the row always has a picture.
  if (img?.tagName === "IMG" && img.matches(".row-thumb img[data-crop]")) {
    const crop = img.dataset.crop;
    delete img.dataset.crop;
    img.src = crop;
    return;
  }
  const tile = img?.tagName === "IMG" ? img.closest(".pick-card") : null;
  if (!tile) return;
  const blank = document.createElement("span");
  blank.className = "pick-blank art-missing";
  blank.setAttribute("aria-hidden", "true");
  blank.textContent = tile.querySelector(".pick-name")?.textContent || "";
  img.replaceWith(blank);
}, true);

function setStatDetail(detail) {
  sValue.title = detail;
  if (detail) statValue.setAttribute("aria-label", detail);
  else statValue.removeAttribute("aria-label");
}

// For the "total" stat, use first enabled condition price (NM-first). Falls back
// to the single legacy market_price when there's no grid.
function chosenPrinting(card, idx) {
  const stored = _variantChoice.get(idx);
  if (stored && card.price_grid?.variants?.[stored]) return stored;
  const names = Object.keys(card.price_grid?.variants || {});
  return names.length === 1 ? names[0] : null;
}

function resetResults() {
  sValue.textContent    = "—";
  setStatDetail("");
  sCond.hidden          = true;
  lotEditionEl.hidden   = true;
  if (lotTotalsEl) { lotTotalsEl.hidden = true; lotTotalsEl.innerHTML = ""; }
  hideDock();
  setNotice("fullsize", false);
  resultsEl.innerHTML   = "";
  resultsEl.appendChild(emptyHint);
}

// The list is rebuilt on every pick and price update: an open hover preview re-checks what is under the pointer.
function renderResults() {
  try { renderResultsList(); } finally { applyPageLinked(); loupe?.refresh(); updateScanLabel(); }
}

function renderResultsList() {
  const cards = _lastResult?.cards || [];
  scheduleSave();
  if (cards.length === 0) { resetResults(); return; }
  emptyHint.remove();

  const { shown, hidden, skipped, notCard } = splitByRecognition(cards);
  const toChoose = shown.filter((idx) => chooseState(cards[idx]) === "choose");
  const confirmed = shown.filter((idx) => chooseState(cards[idx]) !== "choose");
  // A name that is sure but whose printing is open is still to pick: its range and printing tiles are not a priced row.
  const toPick = confirmed.filter((idx) => needsPrinting(cards[idx]));
  const priced = confirmed.filter((idx) => !needsPrinting(cards[idx]));
  const rowOf = (idx) => (_changing.has(idx) ? renderChooseRow(cards[idx], idx, true) : renderCardRow(cards[idx], idx));
  // The lot card, these headings, the review button and the scan summary all read lotCounts.
  const counts = lotCounts(cards);
  // A card with no close match opens its search at once, with its picture beside the results; the row has no Close.
  // It is kept apart from _picker (a picker the user opened), which pauses background re-renders while it is open.
  for (const idx of toChoose) {
    if (candidatesOfCard(cards[idx]).length || searchStateOf(idx)) continue;
    const query = cards[idx].titleQuery ?? "";
    _autoSearch.set(idx, { card: cards[idx], via: "search", query, results: null, noMatch: true });
    if (query.trim()) Promise.resolve().then(() => onSearchInput(idx, query));
  }
  resultsEl.innerHTML = renderChooseGroup(toChoose.map((idx) => renderChooseRow(cards[idx], idx)).join(""), counts.toConfirm, _showChoose, bulkPairs(cards).length)
    + (counts.toPick ? `<div class="group-head pick-head" role="heading" aria-level="2">${escHtml(pickPrintingHeading(counts.toPick))}</div>` + toPick.map(rowOf).join("") : "")
    + (priced.length ? `<div class="group-head priced-head" role="heading" aria-level="2">${escHtml(pricedHeading(priced.length))}</div>` + priced.map(rowOf).join("") : "")
    + renderUnrecognisedGroup(hidden.map((idx) => renderUnrecognisedRow(cards[idx], idx)).join(""), hidden.length, _showUnrecognised)
    + renderSkippedGroup(skipped.map((idx) => renderSkippedRow(idx, cropThumb(cards[idx]), cards[idx].removed === true, cards[idx].removedFromSkipped === true)).join(""), skipped.length, _showSkipped)
    + renderNotCardGroup(notCard.map((idx) => renderNotCardRow(idx, cropThumb(cards[idx]), cards[idx].tooSmall === true, cards[idx].unread === true)).join(""), notCard.length, _showNotCard);
}

function renderCardRow(card, idx) {
  const id   = card.identity || {};
  const name = id.name    || "Card";
  const code = id.setCode || "";
  const set  = id.set     || "";
  const num  = id.number  || "";
  const tier = card.abstain ? "abstain" : confTier(card.confidence);
  const grid = card.price_grid;
  const setKnown = isSetConfirmed(card);

  // A settled row (nothing on it asks the user) is one line until the user opens it.
  const priceHtml = renderPrice(card, idx);
  const settled = isSettledRow({
    inPriced: !needsPrinting(card),
    doubleCheck: needsDoubleCheck(card, idx),
    changing: _changing.has(idx),
    searchOpen: Boolean(searchStateOf(idx)),
    priceIsRange: priceHtml.includes("is-range"),
    versionSuggestedUnconfirmed: (!_variantChoice.get(idx) && Boolean(_variantSuggest.get(idx))) || (Boolean(card.bestGuess) && card.setConfirmed !== true),
    repeatedName: Boolean(card.repeatedName),
  });
  const open = settled && _expanded.has(idx);
  if (settled && !open) return renderCollapsedRow(card, idx, priceHtml);
  const toggle = settled ? rowToggleHtml(idx, rowToggleLabel(card, priceHtml, true), true) : "";

  const setHtml = code ? `<span class="set-chip">${escHtml(code)}</span>` : "";
  const subHtml = setKnown
    ? `${setHtml}${escHtml(set)}${num ? ` <span class="card-number">#${escHtml(num)}</span>` : ""}`
    : "Pick a version";
  const photo = fromSeveralPhotos(_lastResult?.cards) ? photoLabel(card) : "";
  const photoHtml = photo ? ` <span class="photo-chip" title="Read from this photo of the listing">${escHtml(photo)}</span>` : "";

  // A confirmed row offers search as "Change" in its actions; the box opens under the head.
  const searchRow  = renderSearchPanel(idx, true);
  const setRow     = renderSetRow(card, idx);
  const versionRow = renderVersionRow(card, idx);
  const variantRow = setKnown ? renderVariantRow(card, idx) : "";
  const gradedRow  = setKnown ? renderGradedGrid(card, grid) : "";
  const loneEdition = setKnown && Object.keys(grid?.variants || {}).length <= 1 ? editionNote(card) : null;
  const repeatMark = card.repeatedName
    ? ` <span class="repeat-mark" role="img" title="${REPEAT_NOTE}" aria-label="${REPEAT_NOTE}">⚠</span>`
    : "";

  const crop = cropThumb(card);
  const thumb = crop
    ? `<button type="button" class="row-thumb" data-show-on-page data-idx="${idx}" title="Show this card on the page" aria-label="Show ${escHtml(name)} on the page"><img src="${escHtml(crop)}" alt="" width="63" height="88"></button>`
    : "";
  // Why this card? is a button row plus an optional note; the button joins the actions, the note spans the row below.
  const why = whyHtml(card, idx, _whyOpen.has(idx));
  const whyEnd = why.indexOf("</div>") + "</div>".length;
  const whyButton = why ? why.slice(0, whyEnd) : "";
  const whyNote = why ? why.slice(whyEnd) : "";
  const fullName = loneEdition ? `${name}. ${loneEdition}` : name;
  const flagged = needsDoubleCheck(card, idx) && !_picker.has(idx);
  const checkHtml = flagged ? renderDoubleCheck(card, idx, name) : "";

  return `<div class="card-row${flagged ? " double-check" : ""}${open ? " is-open" : ""}" id="card-row-${idx}" data-idx="${idx}" data-state="${overlayStateOf(card)}">
    <div class="card-head">
      <div class="conf-stripe ${tier}"></div>
      ${flagged ? "" : thumb}
      <div class="card-meta">
        <div class="card-name" title="${escHtml(fullName)}">${escHtml(name)}${loneEdition ? ` <span class="sr-only">${escHtml(loneEdition)}</span>` : ""}${guessMark(card, idx)}${repeatMark}${memoryChipHtml(card)}</div>
        <div class="card-sub">${subHtml}${photoHtml}${highValueChipHtml(card, idx)}</div>
      </div>
      ${priceHtml}
      ${toggle}
    </div>
    ${checkHtml}
    <div class="row-actions">
      ${whyButton}
      ${flagged ? "" : changeButtonHtml(idx, name)}
      ${renderRemoveButton(idx)}
    </div>
    ${whyNote}
    ${searchRow}
    ${setRow}
    ${versionRow}
    ${variantRow}
    ${gradedRow}
  </div>`;
}

// The accessible name of a settled row's toggle: "<name>, <set> #<number>, <price>. Show details" (Hide details when open).
function rowToggleLabel(card, priceHtml, open) {
  const id = card.identity || {};
  const set = [id.set || "", id.number ? `#${id.number}` : ""].filter(Boolean).join(" ");
  const price = priceHtml.replace(/<[^>]+>/g, "").trim();
  return `${[id.name || "Card", set, price].filter(Boolean).join(", ")}. ${open ? "Hide" : "Show"} details`;
}

const ROW_CHEVRON = `<svg class="row-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

// The open row's toggle is the chevron alone (its head holds buttons of its own); the collapsed row's holds the whole line.
const rowToggleHtml = (idx, label, open, inner = ROW_CHEVRON) => `<button type="button" class="row-toggle${open ? " row-toggle-chevron" : ""}" data-row-toggle data-idx="${idx}" aria-expanded="${open}" aria-controls="card-row-${idx}" aria-label="${escHtml(label)}">${inner}</button>`;

// One line: the catalog's stock picture (the page crop when there is none, or it fails to load), name, set and number, the
// price cell, a chevron. The photo and the toggle are siblings, so no button holds another.
function renderCollapsedRow(card, idx, priceHtml) {
  const id = card.identity || {};
  const name = id.name || "Card";
  const crop = cropThumb(card);
  const stock = thumbUrl(id);
  const src = stock || crop;
  const thumb = src
    ? `<button type="button" class="row-thumb" data-show-on-page data-idx="${idx}" title="Show this card on the page" aria-label="Show ${escHtml(name)} on the page"><img src="${escHtml(src)}" alt="" loading="lazy" width="63" height="88"${stock && crop ? ` data-crop="${escHtml(crop)}"` : ""}></button>`
    : "";
  const sub = `${escHtml(id.set || "")}${id.number ? ` <span class="card-number">#${escHtml(id.number)}</span>` : ""}`;
  const line = `<span class="card-meta"><span class="card-name" title="${escHtml(name)}">${escHtml(name)}</span><span class="card-sub">${sub}</span></span>${priceHtml}${ROW_CHEVRON}`;
  return `<div class="card-row is-collapsed" id="card-row-${idx}" data-idx="${idx}" data-state="${overlayStateOf(card)}">
    <div class="card-head">
      <div class="conf-stripe ${card.abstain ? "abstain" : confTier(card.confidence)}"></div>
      ${thumb}
      ${rowToggleHtml(idx, rowToggleLabel(card, priceHtml, false), false, line)}
    </div>
  </div>`;
}

const changeButtonHtml = (idx, name) => `<button type="button" class="change-btn" data-open-search data-via="wrong-card" data-idx="${idx}" title="Change: pick the right card" aria-label="Change ${escHtml(name)}, pick the right card">Change</button>`;

// A confirmed card still flagged "High value, double-check": the user has not confirmed it and its typical price is $50 or more.
const needsDoubleCheck = (card, idx) => chooseState(card) === "confirmed" && isHighValue(card, typicalForFlag(card, idx));

// The flagged row's check: the page crop beside the card the scanner matched it to, then Confirm and Change.
// With no matched picture to show, the crop stands alone.
function renderDoubleCheck(card, idx, name) {
  const id = card.identity || {};
  const art = thumbUrl(id);
  const sub = [id.set || id.setCode, id.number ? `#${id.number}` : ""].filter(Boolean).join(" ");
  const matched = art
    ? `<div class="pick-card pick-match" title="${escHtml(`Matched: ${name}${sub ? `, ${sub}` : ""}`)}"><img src="${escHtml(art)}" alt="" loading="lazy" width="63" height="88"><span class="pick-best">Matched</span><span class="pick-name">${escHtml(name)}</span><span class="pick-sub">${escHtml(sub)}</span></div>`
    : "";
  return `<div class="picker double-check-body">
      <div class="pick-row">${renderScannedCard(card, idx)}${matched}</div>
      <div class="choose-actions">
        <button type="button" class="choose-confirm" data-confirm-match data-idx="${idx}" aria-label="${escHtml(`Confirm ${name}, it matches`)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Confirm</button>
        ${changeButtonHtml(idx, name)}
      </div>
    </div>`;
}

const REPEAT_NOTE = "Same name found several times in this photo. Check it.";

// A Choose row's price: the preselected best match's, printing-specific, never a range, always marked unconfirmed.
function renderUnconfirmedPrice(card, cell) {
  if (!bestCandidateOf(card)?.id) return cell("—", "No close match to price");
  const match = matchPriceOf(card);
  if (!match) return cell("…", "Getting the best match's price…");
  const note = "Price of the best match. Not confirmed: choose the card to confirm it.";
  if (match.price == null) return cell("no price", `${match.failed ? "Price unavailable" : "No price data for the best match"}. ${note}`);
  const money = formatUsd(match.price);
  if (match.stale) return cell(`${money} · old price`, `Old price, left out of the lot. ${note}`);
  if (match.kind === "typical") return cell(`${money} typical · unconfirmed`, `Typical price over the versions. ${note}`);
  const printingNote = match.kind === "suggested" ? " At the version the picture suggests: pick the version to settle it." : "";
  return cell(`${money} · unconfirmed`, `${note}${printingNote}`);
}

// One price per card, always in the head: a quote, a range while the set is open, or a dash that says why.
function renderPrice(card, idx) {
  // `kind` only picks the look (is-quote, is-range, is-soft); the text and title are the same as ever.
  const cell = (text, title, kind = "is-soft") => `<div class="card-price ${kind}" title="${escHtml(title)}" aria-label="${escHtml(`${text}. ${title}`)}">${escHtml(text)}</div>`;
  if (card.pricing) return cell("…", "Getting price…");
  if (card.priceError) return cell("—", card.priceError);
  if (card.tooSmall) return cell("—", TOO_SMALL_ROW_TEXT);
  if (card.unread) return cell("—", UNREAD_ROW_TEXT);
  if (card.cardBack) return cell("—", "Turn it over to identify it");
  // A card still to choose shows its best match's price, marked unconfirmed: it is quoted for real only once picked.
  if (!isIdentified(card)) return renderUnconfirmedPrice(card, cell);
  const conditions = enabledConditions();
  // Name sure, printing open: the range across the printings it could be, until the user picks one.
  const openSpan = needsPrinting(card) ? setRangeSpan(card.setRange, conditions) : null;
  if (openSpan) return cell(openSpan, VERSION_NOT_PICKED, "is-range");
  const printing = chosenPrinting(card, idx);
  const quote = quotedPrice(card, printing, conditions);
  if (quote) {
    const others = Object.entries(card.price_grid?.variants?.[quote.printing]?.conditions || {})
      .filter(([cond, price]) => cond !== quote.condition && price != null)
      .map(([cond, price]) => `${cond} $${Number(price).toFixed(2)}`);
    const oldDays = staleDays(card.price_grid);
    const oldTag = isStale(card) ? (oldDays != null ? `Old price: ${oldDays} days` : "Old price") : null;
    const title = [quote.condition, quote.printing ? formatPrinting(quote.printing) : null, sourceFooter(card.price_grid), oldTag, ...others]
      .filter(Boolean).join(" · ");
    return cell("$" + Number(quote.price).toFixed(2), title, "is-quote");
  }
  // A printing the user picked has no price: say so, never borrow another printing's.
  if (chosenPrintingHasNoPrice(card, printing, conditions)) return cell("—", NO_PRICE_FOR_VERSION);
  // Set settled, printing open: the range over its printings, the same one the lot total uses.
  const printings = isSetConfirmed(card) ? setRangeOf([card], conditions) : null;
  if (printings) return cell(setRangeSpan(printings), VERSION_NOT_PICKED, "is-range");
  const span = isSetConfirmed(card) ? null : setRangeSpan(card.setRange, conditions);
  if (span) return cell(span, "Several versions. Pick yours for the exact price.", "is-range");
  return cell("—", "No price data");
}

// Nothing is known about this card, so no name, price or picker: just a way to look it up.
function renderUnrecognisedRow(card, idx) {
  const thumb = cropThumb(card);
  const inPhoto = fromSeveralPhotos(_lastResult?.cards) ? photoLabel(card) : "";
  const label = (card.cardBack || card.tooSmall || card.unread ? `Card ${idx + 1}: ${notReadReason(card)}` : `Card ${idx + 1}`) + (inPhoto ? ` · ${inPhoto}` : "");
  const search = card.cardBack || _picker.get(idx)
    ? ""
    : `<button type="button" class="link-btn" data-open-search data-via="search" data-idx="${idx}" aria-label="Search for card ${idx + 1}">Search for this card</button>`;
  return `<div class="card-row unrec-row" data-idx="${idx}">
    <div class="unrec-line">
      ${thumb ? `<button type="button" class="unrec-thumb" data-show-on-page data-idx="${idx}" title="Show this card on the page" aria-label="Show card ${idx + 1} on the page"><img src="${escHtml(thumb)}" alt="" width="34" height="48"></button>` : ""}
      <span class="unrec-name">${escHtml(label)}</span>
      ${search}
      ${card.unread && !card.tooSmall ? `<button type="button" class="link-btn" data-draw-box aria-label="${escHtml(`Draw a box around card ${idx + 1} to read it`)}">Draw a box</button>` : ""}
    </div>
    ${renderRemoveButton(idx)}
    ${renderSearchPanel(idx)}
  </div>`;
}

function searchResultsHtml(state, idx) {
  if (!state.results) return "";
  if (state.results.length === 0) return `<div class="no-price">No matches. Try the name, the number, or both.</div>`;
  return renderPickList(state.results, idx);
}

const NO_MATCH_TEXT = "No close match. Search for it, or skip it.";

// A card with no candidates has its search open from the start. The state belongs to that card object: when the card
// changes (a pick, a skip, a new scan) the entry no longer matches and is ignored.
function searchStateOf(idx) {
  const own = _picker.get(idx);
  if (own) return own;
  const auto = _autoSearch.get(idx);
  return auto && auto.card === _lastResult?.cards?.[idx] ? auto : null;
}

// A card to choose: the picture beside the closest cards (art, name, set, number), the best one preselected and
// confirmed with one press. No name is asserted for the card and no price is shown until it is picked.
function renderChooseRow(card, idx, changing = false) {
  const candidates = candidatesOfCard(card);
  const cardName = changing ? card.identity?.name || `Card ${idx + 1}` : `Card ${idx + 1}`;
  const best = candidates[0] ? candidateView(card, candidates[0], { best: true }) : null;
  const state = searchStateOf(idx);
  const photo = fromSeveralPhotos(_lastResult?.cards) ? photoLabel(card) : "";
  const photoHtml = photo ? ` <span class="photo-chip" title="Read from this photo of the listing">${escHtml(photo)}</span>` : "";
  const smallHtml = readFromSmallCrop(card)
    ? ` <span class="small-chip" title="Read from a small picture (${Math.round(card.readHeight)} px tall). A full-size photo reads better.">small photo</span>`
    : "";
  const valueHtml = highValueChipHtml(card, idx);
  const repeatMark = card.repeatedName
    ? ` <span class="repeat-mark" role="img" title="${REPEAT_NOTE}" aria-label="${REPEAT_NOTE}">⚠</span>`
    : "";
  const confirm = best
    ? `<button type="button" class="choose-confirm" data-confirm-best data-idx="${idx}" aria-label="${escHtml(`Confirm the best match for card ${idx + 1}: ${best.label}`)}">Confirm ${escHtml(best.name)}</button>`
    : "";
  const search = state
    ? ""
    : `<button type="button" class="link-btn" data-open-search data-via="search" data-idx="${idx}" aria-label="None of these? Search for card ${idx + 1}">None of these? Search</button>`;
  const cancel = changing
    ? `<button type="button" class="link-btn" data-cancel-change data-idx="${idx}" aria-label="${escHtml(`Cancel changing ${cardName}`)}">Cancel</button>`
    : renderSkipButton(idx, card.skippedBefore === true);
  return `<div class="card-row choose-row asking${changing ? " changing" : ""}" data-idx="${idx}">
    ${renderRemoveButton(idx)}
    <div class="card-head">
      <div class="conf-stripe abstain"></div>
      <div class="card-meta">
        <div class="card-name">${escHtml(cardName)}${repeatMark}</div>
        <div class="card-sub"><span class="sub-text">Choose the right card</span>${photoHtml}${smallHtml}${valueHtml}${memoryChipHtml(card, { choose: true })}</div>
      </div>
      ${renderPrice(card, idx)}
    </div>
    <div class="picker" role="group" aria-labelledby="picker-title-${idx}">
      <div class="picker-title" id="picker-title-${idx}">Which card is this?</div>
      <div class="picker-sub">${candidates.length ? "Closest matches, best one first" : NO_MATCH_TEXT}</div>
      ${candidates.length ? `<div class="pick-row">${renderScannedCard(card, idx)}${renderCandidateCards(card, idx)}</div>` : ""}
      <div class="choose-actions">${confirm}${search}${cancel}</div>
    </div>
    ${renderSearchPanel(idx, !candidates.length)}
  </div>`;
}

// The picture the question is about; pressing it scrolls the page to that card.
function renderScannedCard(card, idx) {
  const crop = cropThumb(card);
  return `<button type="button" class="scanned-card" data-show-on-page data-idx="${idx}" title="Show this card on the page" aria-label="The card on the page. Show it on the page.">
    ${crop ? `<img src="${escHtml(crop)}" alt="">` : `<span class="pick-blank" aria-hidden="true"></span>`}
    <span class="scanned-label">${card.inGallery ? escHtml(photoLabel(card) || "Another photo") : "On the page"}</span>
  </button>`;
}

// A priced row's search (opened by Change) keeps the card's picture beside the results, so the user compares as they pick.
function renderSearchPanel(idx, withCrop = false) {
  const state = searchStateOf(idx);
  const crop = withCrop && _lastResult?.cards?.[idx] ? cropThumb(_lastResult.cards[idx]) : null;
  return state
    ? `<div class="picker${crop ? " picker-change" : ""}">
        ${crop ? renderScannedCard(_lastResult.cards[idx], idx) : ""}
        <div class="picker-bar">
          <input class="picker-input" type="search" data-idx="${idx}" value="${escHtml(state.query)}" placeholder="Name or number, e.g. charizard 4/102" aria-label="Search cards by name or number" autocomplete="off">
          ${state.noMatch ? "" : `<button type="button" class="link-btn" data-close-search data-idx="${idx}">Close</button>`}
        </div>
        <div class="sr-only" role="status" data-search-status="${idx}">${matchesLabel(state.results?.length)}</div>
        <div class="pick-row picker-results" data-idx="${idx}">${searchResultsHtml(state, idx)}</div>
      </div>`
    : "";
}

function openSearch(idx, via) {
  const open = _picker.get(idx);
  if (open) open.via = via;
  else _picker.set(idx, { via, query: _lastResult?.cards?.[idx]?.titleQuery ?? "", results: null });
  renderResults();
  const input = resultsEl.querySelector(`.picker-input[data-idx="${idx}"]`);
  input?.focus();
  if (!open && input?.value) onSearchInput(idx, input.value);
}

// Re-rendering drops the focused element, so keyboard users land back on a button in the same card: the opener
// they used, else the row's one search opener (asked rows have only "search", identified rows only "wrong-card"),
// else the first pick or other button in the row, so focus never falls back to the page.
function focusOpener(idx, via = null, strip = null) {
  const row = resultsEl.querySelector(`.card-row[data-idx="${idx}"]`);
  if (!row) return;
  // After a pick in a strip or chip group, focus stays in that group: on its newly checked tile, else the one tapped.
  const group = strip ? row.querySelector(`[data-strip="${strip.kind}"]`) : null;
  const inGroup = group && (group.querySelector('[role="radio"][aria-checked="true"]')
    || [...group.querySelectorAll("[data-strip-pick]")].find((el) => el.dataset.stripPick === strip.id));
  const target = inGroup || (via && row.querySelector(`[data-open-search][data-via="${via}"]`))
    || row.querySelector("[data-open-search]")
    || row.querySelector(".row-toggle")
    || row.querySelector("button[data-pick], button, select, input");
  target?.focus();
}

// A row the list draws with a toggle is settled (collapsible); one that is not still asks the user for something.
const rowIsSettled = (idx) => Boolean(resultsEl.querySelector(`.card-row[data-idx="${idx}"] .row-toggle`));

function closeSearch(idx) {
  const via = _picker.get(idx)?.via;
  _picker.delete(idx);
  renderResults();
  focusOpener(idx, via);
}

// "Change" on a priced card: with candidates it reopens the Choose layout in place (the card stays confirmed, and counted,
// until a pick replaces it); without, it opens the search with the card's picture beside the results.
function startChange(idx) {
  const card = _lastResult?.cards?.[idx];
  if (!card) return;
  if (candidatesOfCard(card).length && chooseState(card) === "confirmed") {
    _changing.clear(); // one row at a time
    _changing.add(idx);
    renderResults();
    (resultsEl.querySelector(`.choose-row[data-idx="${idx}"] [data-confirm-best]`) || resultsEl.querySelector(`.choose-row[data-idx="${idx}"] [data-open-search]`))?.focus();
    return;
  }
  openSearch(idx, "wrong-card");
}

// Cancel or Escape: the card is exactly as it was; focus returns to its Change button.
function cancelChange(idx) {
  _changing.delete(idx);
  _picker.delete(idx);
  renderResults();
  (resultsEl.querySelector(`.card-row[data-idx="${idx}"] [data-via="wrong-card"]`) || resultsEl.querySelector(`.card-row[data-idx="${idx}"] .row-toggle`))?.focus();
}

function onSearchInput(idx, query) {
  const state = searchStateOf(idx);
  if (!state) return;
  state.query = query;
  clearTimeout(_searchTimer);
  const scan = _lastResult;
  if (!query.trim()) {
    state.results = null;
    showSearchResults(idx);
    return;
  }
  _searchTimer = setTimeout(async () => {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ action: "findCards", query, era: eraSelect.value || null });
    } catch (err) {
      resp = { error: explainScanError(err?.message || err) };
    }
    // The box was closed, retyped, or a new scan replaced the cards while this was loading.
    if (_lastResult !== scan || searchStateOf(idx) !== state || state.query !== query) return;
    if (resp?.error) { showMessage(resp.error, true); return; }
    state.results = resp?.cards || [];
    showSearchResults(idx);
  }, 200);
}

// Rewrites only the results so the box being typed in keeps focus.
function showSearchResults(idx) {
  const state = searchStateOf(idx);
  const box = resultsEl.querySelector(`.picker-results[data-idx="${idx}"]`);
  if (state && box) box.innerHTML = searchResultsHtml(state, idx);
  const status = resultsEl.querySelector(`[data-search-status="${idx}"]`);
  if (state && status) status.textContent = matchesLabel(state.results?.length);
}

// What each row shows now, after any fixes: the answers "All right" confirms.
function shownAnswers(cards) {
  return cards.map((card, index) => {
    if (card.drawn) return null;
    if (card.tooSmall || card.unread) return { index, unknown: true };
    if (card.cardBack) return { index, notACard: true };
    return card.identity?.id ? { index, cardId: card.identity.id } : { index, unknown: true };
  }).filter(Boolean);
}

examDismiss.addEventListener("click", () => { examStrip.hidden = true; });

examYes.addEventListener("click", async () => {
  const scan = _lastResult;
  if (!scan) return;
  examYes.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ action: "confirmExam", scanId: scan.bgScanId, answers: shownAnswers(scan.cards), drawnIndices: drawnIndices(scan.cards) });
    if (resp?.error || !resp?.ok) throw new Error(resp?.error || "not sent");
    examStrip.hidden = true;
    showMessage("Thanks. Those results were sent to help check the scanner.");
  } catch {
    showMessage("Couldn't send that. Try again later.", true);
  } finally {
    examYes.disabled = false;
  }
});

// A drawn row's own picture goes with its answer: the scan's crop at that row number is another box's.
const drawnFields = (card) => (card?.drawn ? { drawn: true, crop: card.crop ?? null, share: card.share ?? null } : {});

function pickCard(idx, id, via, row, remember = true) {
  const scan = _lastResult;
  if (!scan?.cards?.[idx]) return;
  const reopened = _changing.has(idx) || _picker.get(idx)?.via === "wrong-card";
  _picker.delete(idx);
  _changing.delete(idx);
  const card = scan.cards[idx];
  // Picking the card the row already has, from a Change, changes nothing: it is a Cancel, and no correction is saved.
  if (reopened && id === card.identity?.id) { cancelChange(idx); return; }
  _expanded.delete(idx); // confirming collapses the row
  const advance = chooseState(card) === "choose" && resultsEl.contains(document.activeElement);
  if (advance) _advanceNote.add(idx); else _advanceNote.delete(idx);
  if (remember) saveCorrectionFor(scan, idx, card, id, via);
  const priced = pickSet(idx, id, row ?? { id });
  if (advance) advanceAfterConfirm(idx, row?.name || card.identity?.name, null, changeAction(idx));
  return priced;
}

// What the scanner believed (its why-record, the price shown) is saved with the user's answer, before the row says "you chose".
// One path for a Choose confirm, a pick and the Confirm of a high-value row.
function saveCorrectionFor(scan, idx, card, id, via) {
  const price = priceTypicalOf(card, chosenPrinting(card, idx), enabledConditions());
  const guess = guessWithWhy(card, price);
  scan.cards[idx] = { ...card, why: userWhy(card.why) };
  chrome.runtime.sendMessage({
    action: "saveCorrection", scanId: scan.bgScanId, index: idx, guess, pickedId: id, via, ...drawnFields(card),
  }).then((resp) => {
    if (resp?.error) { showMessage(resp.error, true); return; }
    const corrected = correctedMark(guess, id, resp);
    const current = _lastResult?.scanId === scan.scanId ? _lastResult.cards[idx] : null;
    if (corrected && current) replaceCard(idx, { ...current, corrected });
  }).catch((err) => showMessage(explainScanError(err?.message || err), true));
}

// "Confirm" on a high-value row: the scanner's own match, confirmed by the user. Saved as a best-match confirm is (via
// "candidates"), never through pickCard, whose same-card pick from Change is a Cancel. The price and total stay as they are.
function confirmMatch(idx) {
  const scan = _lastResult;
  const card = scan?.cards?.[idx];
  const id = card?.identity?.id;
  if (!id || card.userConfirmed) return;
  saveCorrectionFor(scan, idx, card, id, "candidates");
  const choice = _variantPicked.has(idx) ? _variantChoice.get(idx) : null;
  _expanded.delete(idx); // confirming collapses the row
  replaceCard(idx, { ...scan.cards[idx], userConfirmed: true });
  // replaceCard re-seeds the printing from the picture; a printing the user already picked stays.
  if (choice) { _variantChoice.set(idx, choice); _variantPicked.add(idx); _variantSuggest.delete(idx); renderResults(); updateStats(_lastResult.cards); pushOverlay(); }
  resultsEl.querySelector(`.card-row[data-idx="${idx}"] .row-toggle`)?.focus();
  showMessage(`Confirmed ${card.identity?.name || "card"}.`, false, false, changeAction(idx));
}

// A confirmed Choose row leaves the group, so keyboard focus moves to what is next to do: the next row's preselected
// Confirm button, else the lot's Copy button, else Scan. The change is spoken through the message bar.
const _advanceNote = new Set();   // card indexes confirmed from a Choose row: their message says what is left
function toConfirmCount() {
  const cards = _lastResult?.cards || [];
  return splitByRecognition(cards).shown.filter((i) => chooseState(cards[i]) === "choose").length;
}
function confirmedNote(name) {
  const left = toConfirmCount();
  return `Confirmed ${name || "card"}. ${left ? `${left} to confirm.` : "Nothing left to confirm."}`;
}
// Every commit says what happened and offers the way back in its toast (rule 5 of section 10): a pick offers Change, a
// skip or a removal offers Put back. No new undo of a saved correction: Change is the correction path.
// An action is for the lot and card it was made for: if the lot was replaced, or the card is no longer in the state the
// action expects (Change needs a confirmed card, Put back a skipped or removed one), pressing it does nothing.
const changeAction = (idx) => {
  const scanId = _lastResult?.scanId;
  return { label: "Change", run: () => {
    const card = _lastResult?.cards?.[idx];
    if (_lastResult?.scanId !== scanId || !card || card.skipped || chooseState(card) !== "confirmed") return;
    startChange(idx);
  } };
};
const putBackAction = (idx) => {
  const scanId = _lastResult?.scanId;
  return { label: "Put back", run: () => {
    if (_lastResult?.scanId !== scanId || !_lastResult?.cards?.[idx]?.skipped) return;
    putBackAt(idx);
  } };
};

// A new scan, a restore or Clear replaces the lot: its toast action and the page's hover ring belong to the old one.
function onLotReplaced() {
  if (_toastAction) showMessage("");
  _pageLinked = null;
}

// Everything the list remembers about one lot's rows (open "why", open searches, the changing row, the dock, the page's hover
// ring, the "Not a card" group). A new lot, a restored session, Clear and Undo all start from here.
function resetLotUiState() {
  onLotReplaced();
  resultsEl.querySelectorAll(".page-linked").forEach((row) => row.classList.remove("page-linked"));
  _whyOpen = new Set();
  _changing = new Set();
  _expanded = new Set();
  _picker = new Map();
  _autoSearch.clear();
  _showNotCard = false;
  hideDock();
}
function advanceAfterConfirm(idx, name, note = null, action = null) {
  const rows = [...resultsEl.querySelectorAll(".choose-row[data-idx]")];
  const next = rows.find((row) => Number(row.dataset.idx) > idx) || rows[0];
  const target = (next?.querySelector("button[data-confirm-best]") || next?.querySelector("button[data-pick], [data-open-search]"))
    || lotTotalsEl?.querySelector("[data-lot-copy]") || btnScan;
  target.focus({ preventScroll: false });
  showMessage(note ?? confirmedNote(name), false, false, action);
}

// "Can't price this": the card leaves the list, the lot and the export, and the scanner remembers it locally (a similar
// crop is then never confirmed on its own). Focus goes where a confirm sends it: the next row's Confirm button.
function skipAt(idx) {
  const scan = _lastResult;
  const card = scan?.cards?.[idx];
  if (!card || chooseState(card) !== "choose") return;
  _picker.delete(idx);
  _changing.delete(idx);
  const guess = guessWithWhy(card);
  chrome.runtime.sendMessage({ action: "saveSkip", scanId: scan.bgScanId, index: idx, guess, ...drawnFields(card) })
    .then((resp) => { if (resp?.error) showMessage(resp.error, true); })
    .catch((err) => showMessage(explainScanError(err?.message || err), true));
  replaceCard(idx, skipCard(card));
  const left = toConfirmCount();
  advanceAfterConfirm(idx, null, `Skipped. ${left ? `${left} to confirm.` : "Nothing left to confirm."}`, putBackAction(idx));
}

// "Show it": the hidden box becomes a normal row (Choose when it has a read, Too small when it has none) and the page
// overlay draws it. Nothing is confirmed; a pick goes through the usual pick and confirm. The row is part of the saved lot.
function showHiddenAt(idx) {
  const card = _lastResult?.cards?.[idx];
  if (!isNotCard(card)) return;
  const next = showNotCard(card);
  _showChoose = true;
  replaceCard(idx, { ...next, guess: guessOf(next) });
  loadBestMatchPrices(_lastResult);
  resultsEl.querySelector(`.choose-row[data-idx="${idx}"] [data-confirm-best], .choose-row[data-idx="${idx}"] [data-open-search]`)?.focus();
  showMessage(shownMessage(next, toConfirmCount()));
}

// The X on a card, in the list or on the page: the card leaves the scan, the total and the export, and nothing is
// taught (no skip memory). Put back returns it. Only the list's X moves focus; a click on the page leaves the window be.
function removeAt(idx, { fromPage }) {
  const card = _lastResult?.cards?.[idx];
  if (!card || card.removed === true) return;
  const buttons = fromPage ? [] : [...resultsEl.querySelectorAll("button[data-remove-card]")].filter((button) => button.offsetParent !== null);
  const at = buttons.findIndex((button) => Number(button.dataset.idx) === idx);
  const neighbour = at < 0 ? null : buttons[at + 1] || buttons[at - 1] || null;
  _picker.delete(idx);
  _changing.delete(idx);
  dropFromBulk(idx);
  _userEdits = true; // else a rescan from newCardsDetected would replace the list and bring the card back
  replaceCard(idx, removeCard(card));
  sendBoxSignal("removed", _lastResult?.bgScanId, idx, card);
  if (_bulk) _bulk.scan = _lastResult;
  if (!fromPage) (neighbour && resultsEl.querySelector(`button[data-remove-card][data-idx="${neighbour.dataset.idx}"]`) || btnScan).focus();
  showMessage(`Removed card ${idx + 1}. It is left out of the total.`, false, false, putBackAction(idx));
}

// A card taken out of the scan can never be confirmed from the open review panel.
function dropFromBulk(idx) {
  if (!_bulk?.pairs.some((pair) => pair.idx === idx)) return;
  _bulk.pairs = _bulk.pairs.filter((pair) => pair.idx !== idx);
  _bulk.skipped.delete(idx);
  _bulk.explicit.delete(idx);
  if (!_bulk.pairs.length) { closeBulk(false); return; }
  const hadFocus = bulkList.contains(document.activeElement);
  bulkList.innerHTML = _bulk.pairs.map(bulkPairHtml).join("");
  updateBulkCount();
  if (hadFocus) bulkList.querySelector("input")?.focus();
}

// The background forwards a click on a page card's X (it is the one place that decides). Taken only when this window
// holds the lot of that page and is idle; the reply tells it whether the removal is stored here.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action !== "applyOverlayRemove" || !acceptFromBackground(sender, chrome.runtime.id)) return;
  const take = !_restoring && !isScanning && acceptRemove(msg.tabUrl, msg.index, _lotUrl, _lastResult?.cards);
  if (take) removeAt(msg.index, { fromPage: true });
  sendResponse({ handled: take });
});

function putBackAt(idx) {
  const scan = _lastResult;
  const card = scan?.cards?.[idx];
  if (!card?.skipped) return;
  // A removed card taught the skip memory nothing, so only a plain skip has a skip to undo; a removed card's put back is a box signal.
  const removed = card.removed === true;
  if (removed) sendBoxSignal("put-back", scan.bgScanId, idx, card);
  else {
    chrome.runtime.sendMessage({ action: "unskip", scanId: scan.bgScanId, index: idx })
      .then((resp) => { if (resp?.error) showMessage(resp.error, true); })
      .catch((err) => showMessage(explainScanError(err?.message || err), true));
  }
  _showChoose = true;
  replaceCard(idx, putBackCard(card));
  const row = resultsEl.querySelector(`.card-row[data-idx="${idx}"]`);
  (row?.querySelector("[data-confirm-best]") || row?.querySelector("[data-open-search]") || row?.querySelector("[data-remove-card]") || row?.querySelector(".row-toggle") || btnScan).focus();
  showMessage(removed ? (card.removedFromSkipped === true ? "Put back. It is still skipped." : "Put back. It counts in the total again.") : `Put back. ${toConfirmCount()} to confirm.`);
}

resultsEl.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button || !resultsEl.contains(button)) return;
  if ("unrecToggle" in button.dataset) {
    // Changed in place, not re-rendered, so keyboard focus stays on the button.
    _showUnrecognised = !_showUnrecognised; scheduleSave();
    button.setAttribute("aria-expanded", String(_showUnrecognised));
    resultsEl.querySelector("#unrec-list").hidden = !_showUnrecognised;
    return;
  }
  if ("skippedToggle" in button.dataset) {
    _showSkipped = !_showSkipped; scheduleSave();
    button.setAttribute("aria-expanded", String(_showSkipped));
    resultsEl.querySelector("#skipped-list").hidden = !_showSkipped;
    return;
  }
  if ("drawBox" in button.dataset) { startDrawBox(); return; }
  if ("notcardToggle" in button.dataset) {
    _showNotCard = !_showNotCard;
    button.setAttribute("aria-expanded", String(_showNotCard));
    resultsEl.querySelector("#notcard-list").hidden = !_showNotCard;
    return;
  }
  if ("chooseToggle" in button.dataset) {
    _showChoose = !_showChoose; scheduleSave();
    button.setAttribute("aria-expanded", String(_showChoose));
    resultsEl.querySelector("#choose-list").hidden = !_showChoose;
    return;
  }
  if ("reviewAll" in button.dataset) {
    openBulk(button);
    return;
  }
  const idx = Number(button.dataset.idx);
  if ("rowToggle" in button.dataset) {
    if (_expanded.has(idx)) _expanded.delete(idx); else _expanded.add(idx);
    renderResults();
    resultsEl.querySelector(`.row-toggle[data-idx="${idx}"]`)?.focus();
    return;
  }
  if ("confirmMatch" in button.dataset) {
    confirmMatch(idx);
  } else if ("confirmBest" in button.dataset) {
    const best = candidatesOfCard(_lastResult?.cards?.[idx])[0];
    if (best?.id) pickCard(idx, best.id, _changing.has(idx) ? "wrong-card" : "candidates", best);
  } else if ("skipCard" in button.dataset) {
    skipAt(idx);
  } else if ("removeCard" in button.dataset) {
    removeAt(idx, { fromPage: false });
  } else if ("putBack" in button.dataset) {
    putBackAt(idx);
  } else if ("showHidden" in button.dataset) {
    showHiddenAt(idx);
  } else if ("variantConfirm" in button.dataset) {
    const suggested = _variantSuggest.get(idx);
    if (!suggested) return;
    _variantChoice.set(idx, suggested);
    _variantPicked.add(idx);
    _variantSuggest.delete(idx);
    if (!rowIsSettled(idx)) _expanded.delete(idx);
    renderResults();
    focusOpener(idx);
    pushOverlay();
    updateStats(_lastResult.cards);
  } else if ("why" in button.dataset) {
    if (_whyOpen.has(idx)) _whyOpen.delete(idx); else _whyOpen.add(idx);
    renderResults();
    resultsEl.querySelector(`.why-btn[data-idx="${idx}"]`)?.focus();
  } else if ("guessConfirm" in button.dataset) {
    confirmSuggestedSet(idx);
  } else if ("stripMore" in button.dataset) {
    const key = `${idx}:${button.dataset.stripMore}`;
    if (_stripMore.has(key)) _stripMore.delete(key); else _stripMore.add(key);
    renderResults();
    resultsEl.querySelector(`.strip-more[data-strip-more="${button.dataset.stripMore}"][data-idx="${idx}"]`)?.focus();
  } else if ("stripPick" in button.dataset) {
    onStripPick(idx, button);
  } else if (button.dataset.pick) {
    const fromSearch = Boolean(button.closest(".picker-results"));
    const shown = fromSearch ? searchStateOf(idx)?.results : candidatesOfCard(_lastResult?.cards?.[idx]);
    pickCard(
      idx,
      button.dataset.pick,
      _changing.has(idx) ? "wrong-card" : fromSearch ? searchStateOf(idx)?.via || "search" : "candidates",
      shown?.find((card) => card.id === button.dataset.pick),
    );
  } else if ("openSearch" in button.dataset) {
    if (button.dataset.via === "wrong-card") startChange(idx); else openSearch(idx, button.dataset.via);
  } else if ("cancelChange" in button.dataset) {
    cancelChange(idx);
  } else if ("closeSearch" in button.dataset) {
    closeSearch(idx);
  } else if ("showOnPage" in button.dataset) {
    highlightOnPage(idx, true);
  }
});

// The "?" beside the name and a tap on the suggested printing's picture do the same thing.
function confirmSuggestedSet(idx) {
  const card = _lastResult?.cards?.[idx];
  if (!card?.bestGuess) return;
  saveSetCorrection(idx, card.identity?.id, "guess-confirmed");
  _expanded.delete(idx);
  replaceCard(idx, confirmGuess(card));
}

// One tap on a thumbnail or chip. Each kind goes through exactly what its menu did: the printing saves the same
// correction (via "set-menu") and prices the same way, a version swaps the row and saves a correction too (via
// "candidates", unless it is printed in several sets: the set pick saves it), a finish sets the printing for the row.
function onStripPick(idx, button) {
  const card = _lastResult?.cards?.[idx];
  if (!card || button.getAttribute("aria-disabled") === "true") return;
  // The checked tile is the current answer: a no-op, unless it is the suggested printing, which a tap confirms.
  if (button.getAttribute("aria-checked") === "true") {
    if (button.dataset.stripKind === "set" && button.classList.contains("strip-suggested")) confirmSuggestedSet(idx);
    return;
  }
  const value = button.dataset.stripPick;
  const kind = button.dataset.stripKind;
  // A pick that settles a row still asking for its version collapses it; a swap inside a row the user opened leaves it open.
  if (kind !== "version" && !rowIsSettled(idx)) _expanded.delete(idx);
  if (kind === "set") {
    saveSetCorrection(idx, value, "set-menu");
    pickSet(idx, value);
  } else if (kind === "version") {
    const swapped = swapVersion(card, value);
    const swappedId = swapped.identity?.id;
    // A version printed in several sets has no id yet: the set pick that follows saves it.
    if (typeof swappedId === "string" && swappedId) saveSetCorrection(idx, swappedId, "candidates");
    replaceCard(idx, swapped);
    // An earlier "Price updated for <old name>" no longer describes this row.
    refreshStatus(true);
  } else if (kind === "finish") {
    _variantSuggest.delete(idx);
    _variantChoice.set(idx, value);
    _variantPicked.add(idx);
    renderResults();
    pushOverlay();
    updateStats(_lastResult.cards);
    focusOpener(idx, null, { kind: "finish", id: value });
  }
}

// Arrow keys move through a strip or chip group; Enter and Space press the focused one like any button.
function moveInGroup(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const radio = e.target.closest?.('[role="radio"]');
  const group = radio?.closest('[role="radiogroup"]');
  if (!group || !(e.key in keys || e.key === "Home" || e.key === "End")) return false;
  const items = [...group.querySelectorAll('[role="radio"]')];
  const at = items.indexOf(radio);
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, at + keys[e.key]));
  e.preventDefault();
  for (const item of items) item.tabIndex = item === items[next] ? 0 : -1;
  items[next].focus();
  return true;
}

// A thumbnail that fails to load becomes a text tile (name and set), so the choice is never lost.
function failStripArt(img) {
  const art = img?.tagName === "IMG" ? img.closest(".strip-art") : null;
  if (!art) return;
  art.classList.add("no-art");
  img.remove();
}
resultsEl.addEventListener("error", (e) => failStripArt(e.target), true);
// A picture that decodes to a speck is a placeholder, not a card.
resultsEl.addEventListener("load", (e) => {
  if (e.target?.naturalWidth < MIN_ART_PX) failStripArt(e.target);
}, true);

/* ─── Review all: every card to choose beside its preselected candidate, kept or skipped, one Confirm N ─── */

function bulkPairHtml(pair) {
  const card = _bulk.scan.cards[pair.idx];
  const view = candidateView(card, pair.candidate, { best: true });
  const crop = cropThumb(card);
  const kept = !_bulk.skipped.has(pair.idx);
  const check = pair.decisive ? "" : ` <span class="bulk-check">Check</span>`;
  const sub = [view.set, view.number ? `#${view.number}` : "", view.printing].filter(Boolean).join(" · ");
  return `<li class="bulk-pair${kept ? "" : " skipped"}" data-idx="${pair.idx}">
    <label class="bulk-label">
      <input type="checkbox" class="bulk-keep" data-bulk-keep data-idx="${pair.idx}"${kept ? " checked" : ""} aria-label="${escHtml(`Keep card ${pair.idx + 1}: ${view.label}`)}">
      ${crop ? `<img class="bulk-img" src="${escHtml(crop)}" alt="" width="63" height="88">` : `<span class="pick-blank bulk-img" aria-hidden="true"></span>`}
      <span class="bulk-arrow" aria-hidden="true">&rarr;</span>
      ${view.art ? `<img class="bulk-img" src="${escHtml(view.art)}" alt="" loading="lazy" width="63" height="88">` : `<span class="pick-blank bulk-img" aria-hidden="true"></span>`}
      <span class="bulk-text"><b>${escHtml(view.name)}</b>${view.agrees ? ` <span class="pick-agree" title="The name on the card matches">&#10003; name</span>` : ""}${check}<br><span class="bulk-sub">${escHtml(sub)}</span></span>
    </label>
  </li>`;
}

function updateBulkCount() {
  const kept = _bulk.pairs.filter((pair) => !_bulk.skipped.has(pair.idx)).length;
  bulkConfirm.textContent = confirmLabel(kept);
  bulkConfirm.disabled = kept === 0;
  bulkHint.hidden = kept !== 0;
  return kept;
}

function openBulk(opener) {
  const scan = _lastResult;
  const pairs = bulkPairs(scan?.cards);
  if (!pairs.length) return;
  _bulk = { pairs, explicit: new Set(), skipped: new Set(pairs.filter((pair) => !pair.decisive).map((pair) => pair.idx)), opener: opener || document.activeElement, scan };
  bulkList.innerHTML = pairs.map(bulkPairHtml).join("");
  updateBulkCount();
  bulkPanel.hidden = false;
  bulkList.querySelector("input")?.focus();
}

// restoreFocus: false when the list is about to be replaced anyway.
function closeBulk(restoreFocus = true) {
  if (!_bulk) return;
  const opener = _bulk.opener;
  _bulk = null;
  bulkPanel.hidden = true;
  bulkList.innerHTML = "";
  if (!restoreFocus) return;
  const target = opener?.isConnected ? opener : resultsEl.querySelector("[data-review-all], [data-choose-toggle], .card-row button") || btnScan;
  target.focus();
}

function confirmBulk() {
  if (!_bulk) return;
  const { pairs, skipped, scan, explicit } = _bulk;
  const kept = pairs.filter((pair) => !skipped.has(pair.idx) && _lastResult?.cards?.[pair.idx]?.skipped !== true);
  const remembered = new Set(bulkRememberedPairs(kept, explicit).map((pair) => pair.idx));
  closeBulk(false);
  if (_lastResult !== scan) return;
  // Each pair goes through the same pick as a single confirm, so the price is the same. Only a Check pair the user
  // ticked by hand is saved as their correction; ticking the scanner's own preselection confirms it for this session.
  for (const pair of kept) pickCard(pair.idx, pair.candidate.id, "candidates", pair.candidate, remembered.has(pair.idx));
  showMessage(`Confirmed ${kept.length} ${kept.length === 1 ? "card" : "cards"}. Prices are loading.`);
  (resultsEl.querySelector("[data-review-all], [data-choose-toggle]") || btnScan).focus();
}

bulkList.addEventListener("change", (e) => {
  if (!_bulk || !e.target.matches("[data-bulk-keep]")) return;
  const idx = Number(e.target.dataset.idx);
  if (e.target.checked) { _bulk.skipped.delete(idx); _bulk.explicit.add(idx); }
  else { _bulk.skipped.add(idx); _bulk.explicit.delete(idx); }
  e.target.closest(".bulk-pair").classList.toggle("skipped", !e.target.checked);
  updateBulkCount();
});
bulkConfirm.addEventListener("click", confirmBulk);
bulkClose.addEventListener("click", () => closeBulk());
bulkCancel.addEventListener("click", () => closeBulk());
bulkPanel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeBulk();
    return;
  }
  if (e.key !== "Tab") return;
  // The panel covers the popup: keep Tab inside it.
  const focusable = [...bulkPanel.querySelectorAll("input, button")].filter((el) => !el.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

let _highlighted = null;

function highlightOnPage(idx, scroll = false) {
  if (idx === _highlighted && !scroll) return;
  _highlighted = idx;
  chrome.runtime.sendMessage({ action: "highlightCard", index: idx, scroll }).catch(() => {});
}

function rowIndex(target) {
  const row = target?.closest?.(".card-row[data-idx]");
  return row && resultsEl.contains(row) ? Number(row.dataset.idx) : null;
}

// The other direction: the page says which card the pointer is on (null: none). That card's row gets the soft linked ring
// and, on a wide window, the dock shows its crop, as hovering the row does. It never scrolls, and it is not sent back to the page.
let _pageLinked = null;
function applyPageLinked() {
  for (const row of resultsEl.querySelectorAll(".card-row.page-linked")) row.classList.remove("page-linked");
  if (_pageLinked !== null) resultsEl.querySelector(`.card-row[data-idx="${_pageLinked}"]`)?.classList.add("page-linked");
}
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.action !== "overlayHover") return;
  if (!acceptPickSender(sender, chrome.runtime.id, _lotUrl)) return;
  if (msg.index !== null && !Number.isInteger(msg.index)) return;
  _pageLinked = msg.index;
  applyPageLinked();
  const row = _pageLinked === null ? null : resultsEl.querySelector(`.card-row[data-idx="${_pageLinked}"]`);
  if (row?.offsetParent) showDock(row);
});

resultsEl.addEventListener("mouseover", (e) => highlightOnPage(rowIndex(e.target)));
resultsEl.addEventListener("focusin", (e) => highlightOnPage(rowIndex(e.target)));
resultsEl.addEventListener("mouseleave", () => highlightOnPage(null));

resultsEl.addEventListener("keydown", (e) => {
  if (moveInGroup(e)) return;
  if (e.key !== "Escape") return;
  const changeIdx = Number(e.target.closest?.(".card-row.changing")?.dataset.idx);
  if (_changing.has(changeIdx)) {
    e.preventDefault();
    cancelChange(changeIdx);
  } else if (e.target.classList.contains("picker-input")) {
    e.preventDefault();
    closeSearch(Number(e.target.dataset.idx));
  }
});

resultsEl.addEventListener("input", (e) => {
  if (e.target.classList.contains("picker-input")) onSearchInput(Number(e.target.dataset.idx), e.target.value);
});

// The only sign that a printing is a guess; why it was chosen is in the tooltip, not in a sentence.
function guessMark(card, idx) {
  if (!card.bestGuess || card.setConfirmed === true) return "";
  const why = escHtml(card.bestGuess.reason || "Suggested set");
  return ` <button type="button" class="guess-mark" data-guess-confirm data-idx="${idx}" title="${why}" aria-label="Suggested set: ${why}. Press to confirm this set.">?</button>`;
}

// A set the user picked, or a guess they accepted, is an answer worth keeping like any other pick.
function saveSetCorrection(idx, id, via) {
  const message = setMenuCorrection(_lastResult, idx, id, via);
  if (!message) return;
  // A drawn row's picture is not the scan's crop at that index, so the row's own crop goes with it.
  chrome.runtime.sendMessage({ ...message, ...drawnFields(_lastResult.cards[idx]) }).then((resp) => {
    if (resp?.error) showMessage(resp.error, true);
  }).catch((err) => showMessage(explainScanError(err?.message || err), true));
}

// Printings of the same card: a strip of thumbnails, one tap picks (same saveCorrection and pickSet as the old menu).
function renderSetRow(card, idx) {
  const tiles = setTiles(card);
  if (!tiles.length) return "";
  const open = needsPrinting(card);
  // Open: the question and why. After a pick: what was picked, with the strip still there to change it.
  const picked = open ? null : pickedVersionLine(card);
  return `<div class="variant-select-row strip-row set-select-row">
    <span class="lbl${open ? " pick-printing" : ""}">${escHtml(picked || VERSION_TITLE)}</span>
    ${picked ? "" : `<span class="strip-sub">${escHtml(VERSION_SUB)}</span>`}
    ${renderTileStrip({ kind: "set", idx, label: CHOOSE_VERSION_LABEL, tiles, expanded: _stripMore.has(`${idx}:set`), locked: Boolean(card.pricing) })}
  </div>`;
}

// The matcher's best card is shown with its own price; a look-alike version (Pikachu ex beside Pikachu V) is one tap away.
function renderVersionRow(card, idx) {
  const tiles = versionTiles(card, enabledConditions());
  if (!tiles.length) return "";
  return `<div class="variant-select-row strip-row version-select-row">
    <span class="lbl">Other version?</span>
    ${renderTileStrip({ kind: "version", idx, label: "Choose the version", tiles, expanded: _stripMore.has(`${idx}:version`) })}
  </div>`;
}

function replaceCard(idx, next) {
  const hadFocus = resultsEl.contains(document.activeElement);
  const active = document.activeElement?.closest?.("[data-strip-kind]");
  const strip = active ? { kind: active.dataset.stripKind, id: active.dataset.stripPick } : null;
  // Focus on another row's Confirm button (moved there after a confirm) stays on that button through the re-render.
  const keptConfirm = document.activeElement?.matches?.("[data-confirm-best]") && Number(document.activeElement.dataset.idx) !== idx
    ? Number(document.activeElement.dataset.idx) : null;
  const cards = _lastResult.cards.map((card, i) => (i === idx ? next : card));
  _lastResult = { ..._lastResult, cards };
  refreshStatus();
  _variantChoice.delete(idx);
  _variantSuggest.delete(idx);
  _variantPicked.delete(idx);
  seedVariant(next, idx);
  renderResults();
  if (hadFocus && !resultsEl.contains(document.activeElement)) {
    const kept = keptConfirm === null ? null : resultsEl.querySelector(`.choose-row[data-idx="${keptConfirm}"] [data-confirm-best]`);
    if (kept) kept.focus(); else focusOpener(idx, null, strip);
  }
  updateStats(cards);
  pushOverlay();
}

// picked is the catalog row the user chose from candidates or search; null when the set menu was used.
async function pickSet(idx, id, picked = null) {
  const scan = _lastResult;
  const card = scan?.cards?.[idx];
  if (!card) return;
  const token = ++_pickSeq;
  _pickToken.set(idx, token);
  // A new scan replaced the results, or the user picked again, while this price was loading.
  const stale = () => _lastResult?.scanId !== scan.scanId || _pickToken.get(idx) !== token;
  const unpriced = { market_price: null, price_variant: null, price_grid: null, priceError: null };
  if (!id) {
    replaceCard(idx, { ...card, ...unpriced, identity: { name: card.identity?.name }, setConfirmed: false, bestGuess: undefined });
    return;
  }
  const label = picked?.name || card.identity?.name || "this card";
  if (picked) {
    // The other sets on offer no longer apply, and the old card's price must not stay on screen.
    replaceCard(idx, { ...card, ...unpriced, identity: picked, setChoices: [], setConfirmed: false, bestGuess: undefined, pricing: true });
    showMessage(`Getting price for ${label}…`);
  } else {
    replaceCard(idx, { ...card, bestGuess: undefined, pricing: true, priceError: null });
  }
  let resp;
  try {
    // The same answer a Choose row showed for its best match: a pick on a loaded one prices at once.
    resp = await candidatePrice(id);
  } catch (err) {
    resp = { error: explainScanError(err?.message || err) };
  }
  if (stale()) return;
  const current = _lastResult.cards[idx];
  if (!resp || resp.error) {
    const error = resp?.error || "Couldn't get a price. Try again.";
    replaceCard(idx, { ...current, ...unpriced, pricing: false, priceError: error });
    if (picked) showMessage(error, true);
    return;
  }
  const { market_price, price_variant, price_grid } = resp;
  replaceCard(idx, {
    ...current,
    identity: resp.identity,
    ...stampedPrices({ ...current, identity: resp.identity }, { market_price, price_variant, price_grid }),
    setConfirmed: true,
    userConfirmed: true,
    // A card the scanner gave up on is still a card the user named.
    ...(picked ? { abstain: false, confidence: 1 } : {}),
    pricing: false,
    priceError: null,
  });
  if (picked) showMessage(_advanceNote.delete(idx) ? confirmedNote(resp.identity?.name || label) : `Price updated for ${resp.identity?.name || label}.`, false, false, changeAction(idx));
}

// A printing settled by the printed number prices at once; one the picture suggests only preselects the menu.
function seedVariant(card, idx) {
  const settled = detectedVariant(card);
  if (settled) { _variantChoice.set(idx, settled); return; }
  const suggested = suggestedVariant(card);
  if (suggested) _variantSuggest.set(idx, suggested);
}

function renderVariantRow(card, idx) {
  const grid = card.price_grid;
  const chosen = _variantChoice.get(idx) || "";
  const suggested = chosen ? "" : _variantSuggest.get(idx) || "";
  const chips = finishChips(grid, { chosen, suggested, conditions: enabledConditions() });
  const stampOnly = stampFinishNote(card)
    ? `<div class="variant-select-row strip-row"><span class="lbl">${VERSION_ROW_LABEL}</span><span class="variant-note">${escHtml(stampFinishNote(card))}</span></div>`
    : "";
  if (!chips.length) return stampOnly;
  const picked = chosen || suggested;
  const seen = picked && (picked === suggestedVariant(card));
  const stampNote = {
    prerelease: "Prerelease stamp found",
    staff: "Staff stamp found",
    league: "League stamp found",
    setstamp: "Set stamp found",
  }[card.variant?.stamp];
  const note = stampFinishNote(card) || (seen
    ? (stampNote || editionNote(card) || (card.firstEdition ? "1st Edition stamp found" : card.shadow ? "Drop shadow seen" : VERSION_SEEN_TEXT))
    : (editionNote(card) || printingNote(grid)));
  const confirmMark = suggested ? `<button type="button" class="guess-mark" data-variant-confirm data-idx="${idx}" title="Suggested from the picture, which glare can fool. Press to confirm this version." aria-label="Suggested version ${escHtml(formatPrinting(suggested))}. Press to confirm it.">?</button>` : "";
  return `<div class="variant-select-row strip-row">
    <span class="lbl">${VERSION_ROW_LABEL}</span>
    ${renderChipGroup({ idx, label: CHOOSE_VERSION_LABEL, chips, note: note || "", confirmMark })}
  </div>`;
}

function renderGradedGrid(card, grid) {
  if (!grid || !grid.graded) return "";
  const enabled = new Set(enabledGraders());
  const graders = Object.keys(grid.graded).filter((g) => enabled.size === 0 ? false : enabled.has(g));
  if (graders.length === 0) return "";
  const cells = [];
  for (const g of graders) {
    for (const [grade, price] of Object.entries(grid.graded[g])) {
      if (price == null || !Number.isFinite(Number(price))) continue;
      cells.push(`<div class="graded-cell"><span class="g-lbl">${escHtml(g)} ${escHtml(grade)}</span> <span class="g-val">$${Number(price).toFixed(2)}</span></div>`);
    }
  }
  if (cells.length === 0) return "";
  return `<div class="graded-grid">${cells.join("")}</div>`;
}

/* ─── Overlay push ─── */

function pushOverlay() {
  if (!_lastResult) return;
  const cards = overlayCards(_lastResult.cards.map((c, idx) => isNotCard(c) ? c : c.removed === true ? { box: null, removed: true } : ({
    box: c.box,
    docBox: c.docBox,
    identity: c.identity,
    confidence: c.confidence,
    abstain: c.abstain,
    ...(c.inGallery ? { inGallery: true } : {}),
    display: {
      ...computeDisplayForOverlay(c, idx),
      state: overlayStateOf(c),
      ...(readFromSmallCrop(c) ? { small: true } : {}),
      ...(isStale(c) ? { stale: true } : {}),
      ...(isHighValue(c, typicalForFlag(c, idx)) && ["choose", "confirmed"].includes(chooseState(c)) ? { highValue: true } : {}),
      ...overlayGuess(c),
    },
  })));
  const message = {
    action: "overlayWithGrid",
    cards,
    ...(_lastResult.fullSize ? { fullSize: { url: _lastResult.fullSize.url } } : {}),
    srcWidth: _lastResult.srcWidth,
    srcHeight: _lastResult.srcHeight,
  };
  overlayShownLoaded.then(() => chrome.runtime.sendMessage({
    ...message,
    shown: overlayShownToggle.checked,
  })).catch(() => {});
}

// A Choose tag on the page names its best match with the unconfirmed price: 'name? ~$1.20'.
function overlayGuess(card) {
  if (chooseState(card) !== "choose") return {};
  const best = bestCandidateOf(card);
  if (!best?.name) return {};
  const match = matchPriceOf(card);
  return { guess: { name: best.name, price: match ? match.price : null, kind: match ? match.kind : "loading", stale: Boolean(match?.stale) } };
}

function computeDisplayForOverlay(card, idx) {
  // A card to choose shows neither a name nor a price on the page.
  if (card.abstain || chooseState(card) === "choose" || chooseState(card) === "skipped") return null;
  const id = card.identity || {};
  if (!isSetConfirmed(card)) {
    const range = setRangeNote(card.setRange, enabledConditions());
    return { name: id.name || null, price: null, printingNote: range ? `Several versions · ${range}` : "Several versions — pick it in the popup", footer: null };
  }
  const printing = chosenPrinting(card, idx);
  const quote = quotedPrice(card, printing, enabledConditions());
  return {
    name: id.name || null,
    set:  id.set  || null,
    setCode: id.setCode || null,
    number: id.number || null,
    printing: quote?.printing ? formatPrinting(quote.printing) : null,
    condition: quote?.condition || null,
    price: quote ? quote.price : null,
    spreadRatio: card.price_grid?.spreadRatio || 1,
    printingNote: quote ? null : stampFinishNote(card) || (chosenPrintingHasNoPrice(card, printing, enabledConditions()) ? NO_PRICE_FOR_VERSION : printingNote(card.price_grid)),
    footer: sourceFooter(card.price_grid),
  };
}

/* ─── Saved lot (survives the window closing; lib/lot-session.js) ─── */

const THUMB_SIDE = 160;
const SAVE_DELAY_MS = 300;
let _lotUrl = null;       // the page the list is about: where its saved copy is kept
let _lotTabId = null;     // the tab that page was scanned in (null when unknown, e.g. a lot saved before tab ids were kept)
let _saveTimer = null;
let _restoring = false;
const _thumbCache = new Map(); // crop data URL -> its small JPEG

function lotArea() { return chrome.storage?.session; }

// The crop shrunk to THUMB_SIDE px on its long side as a JPEG; null when it cannot be decoded (the row then has no picture).
async function smallCrop(crop) {
  if (typeof crop !== "string" || !crop) return null;
  if (_thumbCache.has(crop)) return _thumbCache.get(crop);
  let thumb = null;
  try {
    const img = new Image();
    img.src = crop;
    await img.decode();
    const scale = Math.min(1, THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    thumb = canvas.toDataURL("image/jpeg", 0.7);
  } catch { thumb = null; }
  _thumbCache.set(crop, thumb);
  return thumb;
}

function scheduleSave() {
  if (_restoring || !_lastResult) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; saveSession().catch(() => {}); }, SAVE_DELAY_MS);
}

async function saveSession() {
  const scan = _lastResult;
  if (!scan || !scan.cards.length || _restoring) return;
  if (!_lotUrl) _lotUrl = (await chrome.runtime.sendMessage({ action: "scanState" }).catch(() => null))?.tabUrl ?? null;
  if (!_lotUrl) return;
  const cards = await Promise.all(scan.cards.map(async (card) => ({ ...card, crop: await smallCrop(card.crop) })));
  if (!_lastResult) return; // cleared meanwhile
  await saveLot(lotArea(), _lotUrl, {
    cards, bgScanId: scan.bgScanId, srcWidth: scan.srcWidth, srcHeight: scan.srcHeight, fullSize: scan.fullSize,
    variantChoice: [..._variantChoice], variantSuggest: [..._variantSuggest], variantPicked: [..._variantPicked],
    lotEdition: _lotEdition, showUnrecognised: _showUnrecognised, showChoose: _showChoose, showSkipped: _showSkipped,
    statusTail: _statusTail,
  });
}
// A window closed inside the delay still keeps its last change.
window.addEventListener("pagehide", () => { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; saveSession().catch(() => {}); } });

function restoreSession(saved) {
  const st = saved.state;
  _restoring = true;
  try {
    _lastResult = { scanId: ++_scanSeq, bgScanId: st.bgScanId, cards: st.cards, srcWidth: st.srcWidth, srcHeight: st.srcHeight,
      fullSize: st.fullSize?.url ? st.fullSize : null };
    resetLotUiState();
    _variantChoice = new Map(st.variantChoice || []);
    _variantSuggest = new Map(st.variantSuggest || []);
    _variantPicked = new Set(st.variantPicked || []);
    _lotEdition = st.lotEdition || "";
    _stripMore = new Set();
    _userEdits = false;
    _showUnrecognised = st.showUnrecognised === true;
    _showChoose = st.showChoose !== false;
    _showSkipped = st.showSkipped === true;
    _statusTail = st.statusTail || "";
    closeBulk(false);
    examStrip.hidden = true;
    updateStats(_lastResult.cards);
    renderResults();
    showFullSizeOffer(_lastResult.fullSize);
    refreshStatus(true);
  } finally { _restoring = false; }
  loadBestMatchPrices(_lastResult);
  const mins = Math.max(0, Math.round((Date.now() - saved.savedAt) / 60000));
  restoreText.textContent = restoredText(mins);
  setNotice("restore", true);
  resultsEl.querySelector(".choose-row [data-confirm-best], .choose-row [data-open-search]")?.focus();
}
restoreRescan.addEventListener("click", () => { setNotice("restore", false); scanPage(); });

// On open: a scan still running (or finished while the window was closed) comes first, then the saved copy of this page.
async function recoverLot() {
  const state = await chrome.runtime.sendMessage({ action: "scanState" }).catch(() => null);
  if (!state) return;
  if (state.tabUrl) _lotUrl = state.tabUrl;
  if (state.running) {
    beginScanUi(state.progress ? `Scanning screen ${state.progress.screen} of ${state.progress.screens}…` : scanActivityText(0));
    const reply = await chrome.runtime.sendMessage({ action: "awaitScan" }).catch(() => null);
    if (reply?.data) applyScanResult(reply.data);
    else showScanError(reply?.error || "Scan didn't finish. Try again.");
    finishScan();
    return;
  }
  const saved = await loadLot(lotArea(), state.tabUrl);
  if (state.finishedAt && state.heldUrl && state.heldUrl === state.tabUrl && (!saved || state.finishedAt > saved.savedAt)) {
    const reply = await chrome.runtime.sendMessage({ action: "awaitScan" }).catch(() => null);
    if (reply?.data) { applyScanResult(reply.data); return; }
  }
  if (saved) {
    restoreSession(saved);
    _lotTabId = restoredLotTabId(state);
  }
}

/* ─── Hover preview (loupe): every card picture opens a large view; candidates are compared with the crop ─── */

const LOUPE_CROP_TILES = ".scanned-card, .row-thumb, .unrec-thumb";
const LOUPE_TILES = `${LOUPE_CROP_TILES}, .pick-card, .strip-tile, .bulk-img`;

// A priced row's picture: the matched card, with the page crop beside it (wide windows show the matched card alone, the crop is in the dock).
function matchedCompareFor(tile) {
  if (!tile.matches(".row-thumb")) return null;
  const idx = Number(tile.closest(".card-row")?.dataset.idx);
  const id = _lastResult?.cards?.[idx]?.identity;
  const art = id ? thumbUrl(id) : null;
  const cropImg = tile.querySelector("img");
  const crop = cropImg?.dataset.crop || cropImg?.src; // a collapsed row's picture is the stock image; its crop rides along
  if (!art || !crop) return null;
  const caption = ["Matched", id.name, id.number ? `#${id.number}` : ""].filter(Boolean).join(" ");
  return { main: { src: art, caption }, page: { src: crop, caption: "On the page" } };
}

function loupeCompareFor(tile) {
  const own = tile.tagName === "IMG" ? tile : tile.querySelector("img");
  if (!own?.src) return null;
  const pair = tile.closest(".bulk-pair");
  const pageImg = pair
    ? pair.querySelector("img.bulk-img")
    : tile.closest(".card-row")?.querySelector(".scanned-card img, .row-thumb img");
  const isCrop = tile.matches(LOUPE_CROP_TILES) || (pair && own === pageImg);
  if (isCrop) return { main: { src: own.src, caption: "On the page" }, page: null };
  const caption = pair
    ? captionOf({ getAttribute: () => [pair.querySelector(".bulk-text b")?.textContent, pair.querySelector(".bulk-sub")?.textContent].filter(Boolean).join(", "), textContent: "" })
    : captionOf({ getAttribute: (n) => (n === "aria-label" ? tile.getAttribute("title") : null), textContent: tile.textContent });
  return {
    main: { src: own.src, caption },
    page: pageImg?.src ? { src: pageImg.src, caption: "On the page" } : null,
  };
}

// The compare dock (two-pane layout): the page crop of the row being compared, under the lot card. The preview then
// shows the hovered card alone at one fixed spot beside the left panel. Under 720 px there is no dock and the
// preview keeps both panels at a fixed top or bottom spot.
const dockEl = document.getElementById("compare-dock");
const dockImg = document.getElementById("dock-img");
const dockCap = document.getElementById("dock-cap");
const twoPane = window.matchMedia("(min-width: 720px)");
let _dockRow = null;

function hideDock() { _dockRow = null; dockEl.hidden = true; dockImg.removeAttribute("src"); }

// Shows the row's crop in the dock at once; a tile with no crop (a review-dialog picture, a row without one) leaves it as it was.
function showDock(tile) {
  if (!twoPane.matches || tile.closest(".bulk-pair")) return;
  const row = tile.closest(".card-row");
  const shown = row?.querySelector(".scanned-card img, .row-thumb img, .unrec-thumb img");
  const src = shown?.dataset.crop || shown?.src;
  if (!row || !src) return;
  const idx = row.dataset.idx;
  if (_dockRow === idx && dockImg.src === src) return;
  _dockRow = idx;
  dockImg.src = src;
  const card = _lastResult?.cards?.[Number(idx)];
  dockCap.textContent = `On the page · ${card?.identity?.name || `Card ${Number(idx) + 1}`}`;
  dockEl.hidden = false;
}

function loupeModeFor(tile) {
  if (tile.closest(".bulk-pair")) return null; // the review dialog keeps the floating preview
  if (!twoPane.matches) return { kind: "fixed" };
  const rect = dockImg.getBoundingClientRect();
  if (dockEl.hidden || !rect.height) return null;
  return { kind: "docked", dock: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }, panelRight: dockEl.closest(".side").getBoundingClientRect().right };
}

loupe = createLoupe({
  doc: document,
  root: document.body,
  loupeEl: document.getElementById("loupe"),
  tileSelector: LOUPE_TILES,
  compareFor: (tile) => matchedCompareFor(tile) || (loupeModeFor(tile)?.kind === "docked" && tile.matches(LOUPE_CROP_TILES) ? null : loupeCompareFor(tile)),
  mode: loupeModeFor,
  onTile: showDock,
  // The review dialog's pair checkbox previews its pair when it takes keyboard focus, as hovering its pictures does: the candidate's picture, beside the crop.
  focusTile: (el) => (el.matches?.(".bulk-keep") ? [...el.closest(".bulk-pair").querySelectorAll(".bulk-img")].at(-1) ?? null : null),
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
});

/* ─── Init ─── */

(async () => {
  // A click on a page card may have opened this window. The record is taken now, so its 10 s age check runs at start-up
  // and not after a restore that waited for a scan; it is shown once the lot is back (a record for another page is dropped).
  const held = await takePendingShow(chrome.storage.session);
  await loadFilters();
  try { await checkReady(); await recoverLot().catch(() => {}); }
  catch (err) {
    setupOverlay.style.display = "flex";
    setupStatus.textContent = explainScanError(err.message);
  }
  const pending = matchPendingShow(held, _lotUrl);
  if (pending !== null) showCardInScanner(pending);
  else if (matchPendingFullSize(held, _lotUrl)) openFullSizePhoto({ fromPage: true });
})();
