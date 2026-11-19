// The one-line note in the scanner window when a new data bundle brought new catalog cards.
// Pure: the worker stores what nextCardDataNote returns, the scanner window shows cardDataNoteText.

export const CARD_DATA_NOTE_KEY = "cardDataNote";

const MAX_SETS = 3;
const MAX_SET_NAME = 200;

const validSetName = (name) => typeof name === "string" && name.length > 0 && name.length <= MAX_SET_NAME;

function validPrev(prev) {
  return prev && typeof prev === "object" && !Array.isArray(prev) && Number.isInteger(prev.count) ? prev : null;
}

function topSets(cards) {
  const counts = new Map();
  for (const card of cards) {
    const name = card?.set; // a new-card entry from parseCatalogExtra: `set` is the set name, `setCode` its code
    if (validSetName(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, MAX_SETS)
    .map(([name]) => name);
}

export function nextCardDataNote(prev, { seq, cards, now } = {}) {
  const before = validPrev(prev);
  const list = Array.isArray(cards) ? cards : [];
  const count = list.length;
  const storedSeq = Number.isFinite(seq) ? seq : null;
  const prevCount = before?.count ?? 0;
  if (before && storedSeq !== null && before.seq === storedSeq && before.count === count) return null;
  if (count > prevCount) {
    return { seq: storedSeq, count, added: count - prevCount, sets: topSets(list), at: now, dismissed: false };
  }
  // No growth: keep the stored record (and its count, so the same cards arriving again are not announced twice).
  return before ? { ...before, seq: storedSeq } : null;
}

function joinNames(names) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function cardDataNoteText(note) {
  if (!note || note.dismissed || !Number.isInteger(note.added) || note.added <= 0) return null;
  const names = Array.isArray(note.sets) ? note.sets.filter(validSetName).slice(0, MAX_SETS) : [];
  const cardsWord = note.added === 1 ? "1 new card" : `${note.added} new cards`;
  const text = `Card data updated: ${cardsWord} from the newest sets can now be recognized.`;
  return names.length ? `${text} Sets include ${joinNames(names)}.` : text;
}

export function dismissedNote(note) {
  return note && typeof note === "object" ? { ...note, dismissed: true } : null;
}
