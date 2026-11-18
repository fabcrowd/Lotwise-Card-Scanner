// Ask-the-user logic: when a scanned card is a guess, which cards to offer,
// how to search the catalog by hand, and what a saved answer looks like.

import { isUnsure } from "./card-display.js";
import { ERAS, inEra, seriesOf } from "./era.js";
import { exactTotalHits, setSizes } from "./card-number.js";
import { choiceName } from "./set-choice.js";
import { sanitizeWhy } from "./why.js";

const VIAS = ["candidates", "search", "wrong-card", "set-menu", "guess-confirmed", "skip", "unskip"];
const JPEG_DATA_URL = /^data:image\/jpeg;base64,/;

export { isUnsure };

/** Up to `limit` distinct catalog rows from a crop's search hits, best first, even when none was good enough to name. */
export function closestMatches(hits, meta, limit = 5) {
  const out = [];
  const seen = new Set();
  for (const hit of hits || []) {
    const row = Array.isArray(meta) ? meta[hit?.index] : null;
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

// A grid tile the matcher could not settle is still shown as its best guess, unsure, with the closest cards to choose
// from. The floor only keeps junk (a picture that resembles no card) from being named; it is not an accept threshold, the
// reads that pass fusion are unchanged. Every abstained tile measured on the Base Set page had a top similarity of 0.66 or more.
export const GUESS_FLOOR = 0.60;
export const GUESS_CONFIDENCE_CAP = 0.49;

/**
 * An abstained read turned into a low-certainty best guess: the closest card is named, the row is unsure (the popup asks
 * "Which card is this?" with the closest cards, best first) and carries no price until the user picks. Anything that is not
 * an abstained read of something card-like is returned untouched.
 * @param lookup id => catalog row
 */
export function asLowCertaintyGuess(read, lookup, floor = GUESS_FLOOR) {
  // A card treated as Japanese is asked about with Japanese candidates, never named as the closest English card.
  if (!read || !read.abstain || read.cardBack || read.japanese) return read;
  const card = read.nearest?.length ? lookup(read.nearest[0]) : null;
  if (!card?.id || !(read.catalogTop >= floor)) return read;
  return {
    ...read,
    identity: card,
    abstain: false,
    unsure: true,
    lowCertainty: true,
    confidence: Math.min(read.confidence || 0, GUESS_CONFIDENCE_CAP),
    market_price: null,
    price_variant: null,
    price_grid: null,
  };
}

// Three printings of a title-named card are kept on the scan row.
export const TITLE_CHOICE_LIMIT = 3;
// Two of the five offered places may go to the title's card; the picture's own candidates keep the rest.
export const TITLE_CANDIDATE_SLOTS = 2;

/** Catalog ids of the first `limit` distinct rows of a search's hits (best first), inside the era when one is given. */
export function titleChoiceIds(hits, meta, { era = null, limit = TITLE_CHOICE_LIMIT } = {}) {
  if (!Array.isArray(hits) || !Array.isArray(meta)) return [];
  const ids = [];
  for (const hit of hits) {
    const row = meta[hit?.index];
    if (!row?.id || ids.includes(row.id) || (era && !inEra(row, era))) continue;
    ids.push(row.id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** The title's cards go right after the first candidate; `out` is returned as it is when none is new. */
function withTitleCards(out, card, rows, limit, era) {
  const wanted = Array.isArray(card.titleChoices) ? card.titleChoices : [];
  if (!wanted.length) return out;
  const have = new Set(out.map((row) => row.id));
  const titled = [];
  for (const id of wanted) {
    const row = rows.get(id);
    if (!row?.id || have.has(row.id) || (era && !inEra(row, era))) continue;
    have.add(row.id);
    titled.push(row);
    if (titled.length >= TITLE_CANDIDATE_SLOTS) break;
  }
  if (!titled.length) return out;
  return [...out.slice(0, 1), ...titled, ...out.slice(1)].slice(0, limit);
}

/** The card the user corrected before first, then set choices, then the scanner's guess, then other printings of the name. */
export function candidatesFor(card, meta, limit = 5, era = null) {
  if (!card) return [];
  const catalog = Array.isArray(meta) ? meta : [];
  const choices = card.setChoices || [];
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const out = [];
  const seen = new Set();
  const add = (row) => {
    if (!row?.id || seen.has(row.id) || out.length >= limit || (era && !inEra(row, era))) return;
    seen.add(row.id);
    out.push(row);
  };
  if (card.referencedId) add(catalog.find((row) => row.id === card.referencedId));
  if (card.lowCertainty && card.identity?.id) {
    // A best guess among the closest cards: the picture's own ranking, best first, before other printings of a name.
    add(card.identity);
    for (const id of card.nearest || []) add(byId.get(id));
    return withTitleCards(out, card, byId, limit, era);
  }
  for (const choice of choices) add(byId.get(choice.id) ?? choice);
  if (card.identity?.id) add(byId.get(card.identity.id) ?? card.identity);
  const name = choiceName(card.identity?.name ?? choices[0]?.name);
  if (name) {
    for (const row of catalog) {
      if (out.length >= limit) break;
      if (choiceName(row.name) === name) add(row);
    }
  }
  if (!card.cardBack && card.nearest?.length) {
    for (const id of card.nearest) add(byId.get(id));
  }
  return withTitleCards(out, card, byId, limit, era);
}

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// "004" and "4" are one number; "TG01" and "TG1" too.
function numberKey(number) {
  return String(number ?? "").toLowerCase().split("/")[0].replace(/^([a-z]*)0+(?=\d)/, "$1");
}

/** "4/102", "#4", "4" and "charizard 4" → name words plus an optional number and set total. */
export function parseSearch(query) {
  const words = [];
  let number = null;
  let total = null;
  for (const token of String(query ?? "").split(/\s+/)) {
    if (!token) continue;
    const slash = token.match(/^#?([a-z0-9]+)\/(\d+)$/i);
    const hashed = token.match(/^#([a-z0-9]+)$/i);
    if (slash) {
      number = slash[1].toLowerCase();
      total = slash[2];
    } else if (hashed) {
      number = hashed[1].toLowerCase();
      total = null;
    } else if (/^\d+$/.test(token) || /^[a-z]{1,4}\d+$/i.test(token)) {
      number = token.toLowerCase();
      total = null;
    } else {
      const parts = normalize(token).split(" ").filter(Boolean);
      words.push(...parts);
    }
  }
  return { words, number, total };
}

const _sizes = new WeakMap();
function sizesOf(meta) {
  if (!_sizes.has(meta)) _sizes.set(meta, setSizes(meta));
  return _sizes.get(meta);
}

/**
 * Catalog rows matching a typed query, best first. With an era, only its cards
 * are returned. Sets whose size matches a typed total come first, then closer names.
 */
export function findCards(meta, query, { era = null, limit = 20 } = {}) {
  const { words, number, total } = parseSearch(query);
  if (!Array.isArray(meta) || (!words.length && !number)) return [];
  const wantNumber = number ? numberKey(number) : null;
  const phrase = words.join(" ");
  const hits = [];
  meta.forEach((card, index) => {
    if (!card || (era && !inEra(card, era))) return;
    if (wantNumber && numberKey(card.number) !== wantNumber) return;
    let quality = 3;
    if (words.length) {
      const name = normalize(card.name);
      if (!words.every((word) => name.includes(word))) return;
      quality = name === phrase ? 0 : name.startsWith(phrase) ? 1 : 2;
    }
    hits.push({ card, index, quality, sized: 1 });
  });
  if (total && number && hits.length) {
    const rows = hits.map((hit) => hit.card);
    for (const at of exactTotalHits(rows, { number, total }, sizesOf(meta))) hits[at].sized = 0;
  }
  hits.sort((a, b) => a.sized - b.sized || a.quality - b.quality || a.index - b.index);
  return hits.slice(0, limit).map((hit) => hit.card);
}

/** A catalog image, else the pokemontcg.io one, else nothing to show. */
export function thumbUrl(card) {
  if (card?.imageUrl) return card.imageUrl;
  if (!card?.setCode || !card?.number) return null;
  const code = encodeURIComponent(card.setCode);
  const number = encodeURIComponent(card.number);
  // Catalog set codes are TCGdex's. pokemontcg.io spells the Scarlet & Violet and Mega ones differently (sv3, not sv03)
  // and answers an unknown id with a card-back picture, so those are asked of the catalog's own host instead.
  const series = seriesOf(card);
  if (series === "sv" || series === "me") return `https://assets.tcgdex.net/en/${series}/${code}/${number}/high.webp`;
  return ERAS.some((era) => era.series.includes(series)) ? `https://images.pokemontcg.io/${code}/${number}.png` : null;
}

/** What the scanner said about a card, kept apart from what the user later chose. */
export function guessOf(card) {
  return {
    id: card?.identity?.id ?? null,
    confidence: Number.isFinite(card?.confidence) ? card.confidence : null,
    abstain: Boolean(card?.abstain),
    choiceIds: (card?.setChoices || []).map((choice) => choice.id),
    catalogTop: Number.isFinite(card?.catalogTop) ? card.catalogTop : null,
    // A row treated as Japanese: whatever the user picks for it, its picture is never kept as a reference (lib/correction-save.js).
    ...(card?.japanese ? { japanese: true } : {}),
  };
}

/**
 * The scanner's guess as it is saved with an answer: what it said at scan time, plus the why-record of the row as it
 * stands now (with the price shown, which only the popup knows) and which reference, if any, was involved.
 */
export function guessWithWhy(card, price = null) {
  const guess = card?.guess ? { ...card.guess } : {};
  if (card?.why) guess.why = { ...card.why, ...(Number.isFinite(price) ? { price } : {}) };
  if (card?.memory?.refId) guess.memory = { refId: card.memory.refId, cardId: card.memory.cardId };
  return guess;
}

/** The card the scanner showed that the user said was wrong, or null: same card, no guess, or only another printing of the name. */
export function wrongIdOf(guessId, pickedId, nameOf) {
  if (!guessId || guessId === pickedId) return null;
  const guessName = nameOf(guessId);
  if (guessName && choiceName(guessName) === choiceName(nameOf(pickedId))) return null;
  return guessId;
}

/** Where the listing was, without the query string, hash or login that could identify the user. */
export function pageUrlForStorage(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return null;
  }
}

export function matchesLabel(count) {
  if (!Number.isInteger(count)) return "";
  if (count === 0) return "No matches";
  return count === 1 ? "1 match" : `${count} matches`;
}

/** One saved answer. Throws on a record that would be useless as a label. */
export function correctionRecord({ ts, scanId, index, pageUrl, guess, pickedId, via, crop, extVersion, why, wrongId, count, history, type }) {
  if (!VIAS.includes(via)) throw new Error(`correction via must be one of ${VIAS.join(", ")}`);
  if (typeof pickedId !== "string" || !pickedId) throw new Error("correction needs a pickedId");
  const cleanWhy = sanitizeWhy(why);
  const linked = typeof scanId === "string" && scanId && Number.isInteger(index) && index >= 0;
  return {
    // One crop has one answer: a later pick for the same scan card replaces the earlier one.
    ...(linked ? { id: `${scanId}:${index}` } : {}),
    ts: Number(ts),
    scanId: linked ? scanId : null,
    index: linked ? index : null,
    pageUrl: pageUrlForStorage(pageUrl),
    guess: {
      id: guess?.id ?? null,
      confidence: Number.isFinite(guess?.confidence) ? guess.confidence : null,
      abstain: Boolean(guess?.abstain),
      choiceIds: Array.isArray(guess?.choiceIds) ? guess.choiceIds.filter((id) => typeof id === "string") : [],
      catalogTop: Number.isFinite(guess?.catalogTop) ? guess.catalogTop : null,
    },
    pickedId,
    via,
    // Only skips carry a type (lib/skip.js); every older row has none.
    ...(type === "skip" ? { type } : {}),
    crop: typeof crop === "string" && JPEG_DATA_URL.test(crop) ? crop : null,
    extVersion: typeof extVersion === "string" ? extVersion : null,
    // Local only. why: what the scanner believed about the row being corrected; wrongId: the card it showed that was wrong.
    ...(cleanWhy ? { why: cleanWhy } : {}),
    wrongId: typeof wrongId === "string" && wrongId ? wrongId : null,
    count: Number.isInteger(count) && count > 0 ? count : 1,
    history: Array.isArray(history) ? history.slice(-3) : [],
  };
}

/**
 * The saveCorrection message for a set picked from the Set? menu or a guessed set the user accepted, or null
 * when there is nothing to save. The scan's own guess rides along so the answer is kept against what it said.
 */
export function setMenuCorrection(scan, index, pickedId, via) {
  const card = scan?.cards?.[index];
  if (!card || !pickedId) return null;
  return { action: "saveCorrection", scanId: scan.bgScanId, index, guess: guessWithWhy(card), pickedId, via };
}

export function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pickLabel(card) {
  return [card.name, card.set || card.setCode, card.number ? `number ${card.number}` : ""].filter(Boolean).join(", ");
}

/** A row of thumbnail buttons. Each value is escaped here because the result goes into innerHTML. */
export function renderPickList(cards, idx, guessId = null) {
  return (cards || []).map((card) => {
    const guess = guessId != null && card.id === guessId;
    const label = escHtml(pickLabel(card));
    const url = thumbUrl(card);
    const image = url
      ? `<img src="${escHtml(url)}" alt="${label}" loading="lazy" width="63" height="88">`
      : `<span class="pick-blank" aria-hidden="true"></span>`;
    const sub = [card.set || card.setCode, card.number ? `#${card.number}` : ""].filter(Boolean).join(" ");
    const tag = guess ? `<span class="pick-guess">Suggested</span>` : "";
    return `<button type="button" class="pick-card${guess ? " pick-card-guess" : ""}" data-pick="${escHtml(card.id)}" data-idx="${idx}" aria-label="${guess ? `Suggested: ${label}` : label}" title="${label}">${image}${tag}<span class="pick-name">${escHtml(card.name)}</span><span class="pick-sub">${escHtml(sub)}</span></button>`;
  }).join("");
}

/** The "Not read (n)" group heading; the chevron shows whether it is open. */
export function unrecognisedLabel(count) {
  return `Not read (${count})`;
}

/** The crop picture a scan may carry for a card; anything but a JPEG data URL is ignored. */
export function cropThumb(card) {
  const crop = card?.crop;
  return typeof crop === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(crop) ? crop : null;
}

/** One disclosure button over the compact rows (already-escaped HTML) of cards nothing could be said about. */
export function renderUnrecognisedGroup(rowsHtml, count, expanded) {
  if (!count) return "";
  return `<div class="unrec">
    <button type="button" class="unrec-toggle" data-unrec-toggle aria-expanded="${expanded}" aria-controls="unrec-list">${escHtml(unrecognisedLabel(count))}</button>
    <div id="unrec-list" class="unrec-list"${expanded ? "" : " hidden"}>${rowsHtml}</div>
  </div>`;
}
