// Japanese cards: a separate list next to the English catalog. Its cards never enter the English search, so every English
// code path stays as it is. A scan that looks Japanese is asked about (Japanese candidates first), never confirmed.

import { findCards, parseSearch } from "./card-picker.js";

export const JA_ASSET = "catalog-ja.bin.gz";
// Fitted by the preregistered study in card-scanner-data/data/reports/japanese-20261117/ to this recognizer, crop and catalog;
// refit them when any of the three changes. A crop must score this much higher against the Japanese cards than against
// the English ones, and be at least this tall in the scanned picture, to be treated as Japanese.
export const JA_MARGIN = 0.005;
export const JA_MIN_HEIGHT = 200;
// Whether the automatic rule is on.
export const JA_AUTO = true;

// After a failed load (download, hash or parse), the next attempt waits this long; callers get no catalog meanwhile.
export const JA_RETRY_MS = 10 * 60 * 1000;

/** True when a load that failed at `failedAt` (null: none failed) may be tried again at `now`. */
export const jaRetryAllowed = (failedAt, now) => failedAt == null || now - failedAt >= JA_RETRY_MS;

/**
 * Runs `load` (which throws on failure) at most once at a time. A success is kept for good; a failure blocks new attempts
 * for JA_RETRY_MS. Every call resolves, never rejects.
 */
export function createJaLoader(load, now = Date.now) {
  let pending = null;
  let loaded = false;
  let failedAt = null;
  return function run() {
    if (loaded) return Promise.resolve();
    if (pending) return pending;
    if (!jaRetryAllowed(failedAt, now())) return Promise.resolve();
    pending = (async () => {
      try {
        await load();
        loaded = true;
      } catch {
        failedAt = now();
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

/** What the options page says about the Japanese card list: { state: "off" | "ready" | "unavailable", count? } as plain words. */
export function japaneseStateText(info) {
  if (info?.state === "ready" && Number.isInteger(info.count)) return `Ready: ${info.count.toLocaleString("en-US")} Japanese cards.`;
  if (info?.state === "off") return "Off.";
  return "Not available yet. It is tried again later.";
}

const DIM = 512;
const MAX_CARDS = 100_000;
const MAX_TEXT = 200;
const JA_PREFIX = "jp-";
const IMAGE_BASE = "https://tcgplayer-cdn.tcgplayer.com/product/";
const JA_CANDIDATES = 4;
const CANDIDATE_LIMIT = 5;

/** The bytes of a gzip file, unpacked. */
export async function gunzip(arrayBuffer) {
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const isText = (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_TEXT;

/**
 * Checks the layout of an unpacked catalog-ja file and returns { n, scales, rows, cards }. Throws an Error naming the
 * problem. A file fitted for another recognizer (`query`) or crop version (`crop`) than `expected` is refused.
 */
export function parseJaCatalog(bytes, expected) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength < 4) throw new Error("Japanese catalog is too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLength = view.getUint32(0, true);
  if (4 + headerLength > data.byteLength) throw new Error("Japanese catalog header runs past the end of the file");
  let header;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(4, 4 + headerLength)));
  } catch {
    throw new Error("Japanese catalog header is not valid JSON");
  }
  if (!header || typeof header !== "object") throw new Error("Japanese catalog header is not an object");
  if (header.v !== 1) throw new Error(`Japanese catalog version ${header.v} is not supported`);
  if (header.dim !== DIM) throw new Error(`Japanese catalog dimension ${header.dim} is not ${DIM}`);
  if (!Number.isInteger(header.entries) || header.entries < 0 || header.entries > MAX_CARDS) throw new Error("Japanese catalog entry count is out of range");
  if (!Array.isArray(header.cards) || header.cards.length !== header.entries) throw new Error("Japanese catalog entries do not match its card list");
  if (header.query !== expected?.query) throw new Error("Japanese catalog was fitted for another recognizer");
  if (header.crop !== expected?.crop) throw new Error("Japanese catalog was made for another crop version");
  const n = header.entries;
  if (data.byteLength !== 4 + headerLength + n * 4 + n * DIM) throw new Error("Japanese catalog has the wrong size");
  const seen = new Set();
  const cards = header.cards.map((card, i) => {
    if (!card || !Number.isInteger(card.pid) || !Number.isInteger(card.gid)) throw new Error(`Japanese card ${i} has no integer pid and gid`);
    if (seen.has(card.pid)) throw new Error(`Japanese card ${i} repeats product ${card.pid}`);
    seen.add(card.pid);
    for (const key of ["name", "set", "number"]) {
      if (!isText(card[key])) throw new Error(`Japanese card ${i} has a bad ${key}`);
    }
    return {
      id: `${JA_PREFIX}${card.pid}`,
      name: card.name,
      set: `${card.set} (Japanese)`,
      number: card.number,
      imageUrl: `${IMAGE_BASE}${card.pid}_200w.jpg`,
      lang: "ja",
      tcgPlayerId: card.pid,
      groupId: card.gid,
    };
  });
  // Copies, so alignment never matters.
  const scaleStart = 4 + headerLength;
  const scales = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    scales[i] = view.getFloat32(scaleStart + i * 4, true);
    if (!Number.isFinite(scales[i]) || !(scales[i] > 0)) throw new Error(`Japanese card ${i} has a scale that is not a number above 0`);
  }
  const rows = new Int8Array(n * DIM);
  rows.set(new Int8Array(data.buffer, data.byteOffset + scaleStart + n * 4, n * DIM));
  return { n, scales, rows, cards };
}

/** The `k` rows closest to a unit query vector, best first: [{ index, score }]. */
export function searchJa(ja, query, k = 5) {
  const best = [];
  for (let i = 0; i < ja.n; i++) {
    let dot = 0;
    const at = i * DIM;
    for (let d = 0; d < DIM; d++) dot += query[d] * ja.rows[at + d];
    const score = dot * ja.scales[i];
    if (best.length >= k && score <= best[best.length - 1].score) continue;
    let place = best.length;
    while (place > 0 && best[place - 1].score < score) place--;
    best.splice(place, 0, { index: i, score });
    if (best.length > k) best.pop();
  }
  return best;
}

export const isJaId = (id) => typeof id === "string" && id.startsWith(JA_PREFIX);

/** True when a crop is to be treated as a Japanese card. `rule` lets a test change the constants. */
export function japaneseVerdict({ bestJa, bestEn, height }, rule = {}) {
  const { auto = JA_AUTO, margin = JA_MARGIN, minHeight = JA_MIN_HEIGHT } = rule;
  return Boolean(auto) && height >= minHeight && bestJa - bestEn >= margin;
}

const JA_NEAREST = 5;

/**
 * The read for a crop treated as Japanese, or null. `bestEn` is the top raw cosine against the English catalog and `height`
 * the card's height in the scanned picture. The caller adds the English `nearest` and `ranked` lists.
 */
export function japaneseRead(ja, embedding, { bestEn, height }, rule) {
  // With no English score to compare with (no physical English hit), nothing can be called more Japanese than English.
  if (!ja || !Number.isFinite(bestEn) || !(bestEn > 0)) return null;
  // The 25,000-row search runs only for a card the rule could accept; `rule.search` lets a test count the calls.
  const { auto = JA_AUTO, minHeight = JA_MIN_HEIGHT, search = searchJa } = rule || {};
  if (!auto || !(height >= minHeight)) return null;
  const hits = search(ja, embedding, JA_NEAREST);
  const bestJa = hits[0]?.score ?? 0;
  if (!japaneseVerdict({ bestJa, bestEn, height }, rule)) return null;
  return {
    identity: null, confidence: 0, abstain: true, japanese: true,
    // Read only by acceptWholePhoto (photo-detection.js), which judges a whole-photo read by it.
    bestJa,
    jaNearest: hits.map((hit) => ja.cards[hit.index].id),
    market_price: null, price_variant: null, price_grid: null,
  };
}

/** The candidates for a card to choose: a Japanese card's Japanese cards first, any other card's English list as it is. */
export function chooseCandidates(card, english, jaById) {
  if (!card.japanese) return english;
  const jaCards = jaById ? (card.jaNearest || []).map((id) => jaById.get(id)).filter(Boolean) : [];
  return japaneseCandidates(jaCards, english);
}

/** The typed search's list: the English results alone without a Japanese catalog, merged with the Japanese ones with it. */
export function searchAll(english, ja, query, japaneseRow) {
  return ja ? mergeSearchResults(english, findJaCards(ja, query, 20), japaneseRow === true) : english;
}

/** The first 4 Japanese cards, then the first English one, then what remains, 5 in all and no repeated id. */
export function japaneseCandidates(jaCards, englishCards) {
  const out = [];
  const seen = new Set();
  const add = (card) => {
    if (!card?.id || seen.has(card.id) || out.length >= CANDIDATE_LIMIT) return;
    seen.add(card.id);
    out.push(card);
  };
  for (const card of (jaCards || []).slice(0, JA_CANDIDATES)) add(card);
  const english = englishCards || [];
  add(english[0]);
  for (const card of (jaCards || []).slice(JA_CANDIDATES)) add(card);
  for (const card of english.slice(1)) add(card);
  return out;
}

const SEARCH_TOTAL = 20;
const SEARCH_MAJOR = 12;
const SEARCH_MINOR = 8;

/**
 * One search list of at most 20: up to 12 of the group the row belongs to, then up to 8 of the other (Japanese first for a
 * Japanese row). A slot one group does not use goes to the other.
 */
export function mergeSearchResults(english, japanese, japaneseFirst = false) {
  const [major, minor] = japaneseFirst ? [japanese, english] : [english, japanese];
  const majorTake = Math.min(major.length, SEARCH_MAJOR + Math.max(0, SEARCH_MINOR - minor.length));
  const minorTake = Math.min(minor.length, SEARCH_MINOR + Math.max(0, SEARCH_MAJOR - major.length), SEARCH_TOTAL - majorTake);
  return [...major.slice(0, majorTake), ...minor.slice(0, minorTake)];
}

/** Japanese cards matching a typed query, by name words and number (a typed set total is ignored). */
export function findJaCards(ja, query, limit = 20) {
  const { words, number } = parseSearch(query);
  const text = [...words, number ? `#${number}` : ""].filter(Boolean).join(" ");
  return findCards(ja?.cards, text, { limit });
}
