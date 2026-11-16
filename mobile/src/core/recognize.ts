// Recognizes one cropped card. The sequence follows the extension's background.js (recognizeWith, printingFromNumber,
// checkTitle, guessFromTitle) step for step, using the same lib functions; that sequence lives inside the extension's
// service worker and cannot be imported, so it is restated here. Left out because the phone has no data for them
// yet: the era filter, saved corrections, the community pack, the 1st Edition and set-symbol reads.
//
// One deliberate difference. The confirm rule's thresholds (lib/fusion.js) were fitted to Chrome's canvas resampling
// and the wasm runtime; the phone differs in both. Until the rule is measured on phone photos, a picture match never
// confirms a card here: every card waits for the user's tap, with the scanner's best match first.

import {
  type ConfirmOptions, CONFIRM_MIN_HEIGHT, SMALL_SOURCE_CONFIDENCE_CAP, candidatesFor, capUnconfirmedSet, choiceName,
  choiceSummary, closestMatches, extendsTitle, fuseResults, isCardBack, markChoose, physicalHits, printingByNumber,
  scoreIndices, searchCatalog, setChoices, setSizes, titleChoiceIds, titleVerdict,
} from './ext';
import type { CanvasLike, CatalogCard, Hit, NumberRead, PriceFields, RankedId, ScanRow } from './types';

const SEARCH_DEPTH = 20;
const TITLE_RERANK_DEPTH = 20;
const TITLE_MIN_HEIGHT = CONFIRM_MIN_HEIGHT;
// The collector number is read only from crops this tall (source pixels), as in the extension.
const NUMBER_MIN_HEIGHT = 600;
const CANDIDATE_LIMIT = 5;
const RANKED_LIMIT = 10;
const UNPRICED: PriceFields = { market_price: null, price_variant: null, price_grid: null };

export interface RecognizerDeps {
  meta: readonly CatalogCard[];
  embed(card: CanvasLike): Promise<Float32Array>;
  /** The card's title line, when the text models are present. */
  readName?: (card: CanvasLike) => Promise<string>;
  /** The collector number, when the text models are present. */
  readNumber?: (card: CanvasLike) => Promise<NumberRead | null>;
  log?: (message: string) => void;
}

export interface Recognizer {
  recognize(card: CanvasLike, height: number): Promise<ScanRow>;
  catalogCard(id: string): CatalogCard | undefined;
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export function createRecognizer({ meta, embed, readName, readNumber, log = () => {} }: RecognizerDeps): Recognizer {
  const byId = new Map(meta.map((card) => [card.id, card]));
  const names = [...new Set(meta.map((card) => card.name).filter(Boolean))];
  const indicesByName = new Map<string, number[]>();
  meta.forEach((card, index) => {
    const key = choiceName(card.name);
    const rows = indicesByName.get(key);
    if (rows) rows.push(index);
    else indicesByName.set(key, [index]);
  });
  const sizes = setSizes(meta);
  const printingsOf = (name: string | undefined): number[] => indicesByName.get(choiceName(name)) ?? [];
  const physicalPrintings = (name: string | undefined): CatalogCard[] =>
    physicalHits(printingsOf(name).map((index) => ({ index })), meta).map(({ index }) => meta[index]);

  function rankedIds(hits: readonly Hit[]): RankedId[] {
    const out: RankedId[] = [];
    for (const hit of hits) {
      const id = meta[hit.index]?.id;
      if (id && !out.some((row) => row.id === id)) out.push({ id, rank: round4(hit.rank ?? hit.score), score: round4(hit.score) });
      if (out.length >= RANKED_LIMIT) break;
    }
    return out;
  }

  const closestIds = (hits: readonly Hit[]): string[] => closestMatches(hits, meta, CANDIDATE_LIMIT).map((card) => card.id);

  function hitScore(hits: readonly Hit[], id: string): number | undefined {
    const hit = hits.find((h) => meta[h.index]?.id === id);
    return hit ? Math.round(hit.score * 1000) / 1000 : undefined;
  }

  async function readTitle(card: CanvasLike, height: number): Promise<string | null> {
    if (!readName || !(height >= TITLE_MIN_HEIGHT)) return null;
    try {
      return await readName(card);
    } catch (err) {
      log(`title read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** The printing named by the collector number: among the recognized name's printings first, then the look-alikes. */
  async function printingFromNumber(
    card: CanvasLike, name: string | null, hits: readonly Hit[],
  ): Promise<{ card?: CatalogCard; read?: string; text?: string } | null> {
    if (!readNumber) return null;
    let read: NumberRead | null;
    try {
      read = await readNumber(card);
    } catch (err) {
      log(`number read failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    if (!read?.number) return read?.text ? { text: read.text } : null;
    const namedRows = name ? physicalPrintings(name) : [];
    const lookalikes = [...new Map(hits.map(({ index }) => [meta[index].id, meta[index]])).values()];
    for (const rows of [namedRows, lookalikes]) {
      const at = printingByNumber(rows, read, sizes);
      if (at == null) continue;
      return { card: rows[at], read: `${read.number}/${read.total}`, text: read.text };
    }
    return read.text ? { text: read.text } : null;
  }

  /** The picture's read with its printing: settled by the number, left open as set choices, or a single printing. */
  async function withPrinting(
    fused: ReturnType<typeof fuseResults>, card: CanvasLike, height: number, hits: readonly Hit[],
  ): Promise<ScanRow> {
    const { confidence, abstain } = fused;
    const identity = fused.identity as CatalogCard | null;
    const named = abstain || !identity ? null : identity.name;
    const numbered = height >= NUMBER_MIN_HEIGHT ? await printingFromNumber(card, named, hits) : null;
    const ocrText = numbered?.text ?? '';
    if (numbered?.card) {
      return { identity: numbered.card, confidence, abstain: false, numberRead: numbered.read, ocrText, ...UNPRICED };
    }
    if (!named || !identity) return { identity, confidence, abstain, ocrText, ...UNPRICED };
    const choices = setChoices(identity, hits, meta);
    if (choices.length > 1) {
      return {
        identity: { name: identity.name },
        confidence,
        abstain,
        setChoices: choices.map((row) => ({ ...choiceSummary(row), score: hitScore(hits, row.id) })),
        ocrText,
        ...UNPRICED,
      };
    }
    const setUnconfirmed = physicalPrintings(identity.name).length > 1;
    return { identity, confidence, abstain, ocrText, ...(setUnconfirmed ? { setUnconfirmed } : {}), ...UNPRICED };
  }

  /** The title names another catalog card that is among the closest matches: that card becomes the guess. */
  function guessFromTitle(card: CatalogCard, hits: readonly Hit[], before: ScanRow): ScanRow {
    const base: ScanRow = {
      identity: card,
      confidence: Math.min(Math.max(before.confidence ?? 0, 0), SMALL_SOURCE_CONFIDENCE_CAP),
      abstain: false,
      unsure: true,
      titleReranked: true,
      catalogTop: before.catalogTop ?? null,
      ocrText: before.ocrText ?? '',
      ...UNPRICED,
    };
    const choices = setChoices(card, hits, meta);
    if (choices.length <= 1) return base;
    return {
      ...base,
      identity: { name: card.name },
      setChoices: choices.map((row) => ({ ...choiceSummary(row), score: hitScore(hits, row.id) })),
    };
  }

  /** The card's own title line as a second opinion. It can demote or redirect a read; it never confirms one. */
  function checkTitle(row: ScanRow, hits: readonly Hit[], title: string | null, embedding: Float32Array): ScanRow {
    if (row.cardBack || row.numberRead || title == null) return row;
    const name = row.abstain ? null : row.identity?.name ?? null;
    const verdict = titleVerdict(name, title, names);
    if (verdict.kind === 'silent') return row;
    if (verdict.kind === 'agree') return { ...row, titleConfirmed: true };
    const wanted = choiceName(verdict.titleName);
    const closest = hits.slice(0, TITLE_RERANK_DEPTH);
    const hit = closest.find((h) => meta[h.index] && choiceName(meta[h.index].name) === wanted);
    const longer = closest.some((h) => meta[h.index] && extendsTitle(meta[h.index].name, verdict.titleName));
    if (hit && !longer) return guessFromTitle(meta[hit.index], hits, row);
    // The title's card is not among the picture's matches: its best-looking printings are offered in the list.
    const titleChoices = titleChoiceIds(physicalHits(scoreIndices(embedding, printingsOf(verdict.titleName)), meta), meta);
    const offered = titleChoices.length ? { titleChoices } : {};
    // No picture name to contradict: the title's cards join the list, and nothing is marked as contradicted.
    if (!name) return { ...row, ...offered };
    return {
      ...row,
      confidence: Math.min(row.confidence ?? 0, SMALL_SOURCE_CONFIDENCE_CAP),
      unsure: true,
      titleContradicts: verdict.titleName,
      ...offered,
    };
  }

  async function recognize(card: CanvasLike, height: number): Promise<ScanRow> {
    const embedding = await embed(card);
    const hits = physicalHits(searchCatalog(embedding, SEARCH_DEPTH), meta);
    const catalogTop = hits[0]?.score ?? null;
    if (isCardBack(embedding, hits[0]?.score ?? 0)) {
      return { identity: null, confidence: 0, abstain: true, cardBack: true, catalogTop, ...UNPRICED };
    }
    const title = await readTitle(card, height);
    const confirm: ConfirmOptions = { height };
    if (title != null) {
      confirm.contradicts = (name) => Boolean(name) && titleVerdict(name, title, names).kind === 'contradict';
    }
    const fused = fuseResults(hits, null, meta, null, confirm);
    const read = await withPrinting(fused, card, height, hits);
    const flagged: ScanRow = { ...read, catalogTop, ...(fused.choose && !read.numberRead ? { choose: true } : {}) };
    const checked = checkTitle(markChoose(capUnconfirmedSet(flagged), height), hits, title, embedding);
    const pictureConfirmed = !checked.abstain && checked.unsure !== true && Boolean(checked.identity?.name);
    // On the phone every card waits for the user (see the note at the top of this file).
    const waiting: ScanRow = { ...checked, nearest: closestIds(hits), ranked: rankedIds(hits), unsure: true, pictureConfirmed };
    return { ...waiting, candidates: candidatesFor(waiting, meta, CANDIDATE_LIMIT) };
  }

  return { recognize, catalogCard: (id) => byId.get(id) };
}

/** The user picked `card` for this row: it is named and settled, and its price is about to be fetched. */
export function confirmPick(row: ScanRow, card: CatalogCard): ScanRow {
  const { setChoices: _open, setUnconfirmed: _unconfirmed, priceError: _error, ...rest } = row;
  return {
    ...rest,
    identity: card,
    abstain: false,
    unsure: false,
    setConfirmed: true,
    userConfirmed: true,
    pricing: true,
    market_price: null,
    price_variant: null,
    price_grid: null,
  };
}
