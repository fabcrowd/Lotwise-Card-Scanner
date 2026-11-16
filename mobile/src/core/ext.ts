// The one place the app reaches into the extension's source (tools/extension-wasm/lib). Those modules are plain
// JavaScript, so each import is given its TypeScript signature here and nowhere else. Nothing is copied: a change
// to the extension's logic reaches the app on the next build.

import * as cardBackJs from '../../../tools/extension-wasm/lib/card-back.js';
import * as cardDisplayJs from '../../../tools/extension-wasm/lib/card-display.js';
import * as cardNumberJs from '../../../tools/extension-wasm/lib/card-number.js';
import * as cardPickerJs from '../../../tools/extension-wasm/lib/card-picker.js';
import * as chooseFlowJs from '../../../tools/extension-wasm/lib/choose-flow.js';
import * as conditionPricingJs from '../../../tools/extension-wasm/lib/condition-pricing.js';
import * as detectJs from '../../../tools/extension-wasm/lib/detect.js';
import * as embedJs from '../../../tools/extension-wasm/lib/embed.js';
import * as fusionJs from '../../../tools/extension-wasm/lib/fusion.js';
import * as lotExportJs from '../../../tools/extension-wasm/lib/lot-export.js';
import * as ocrJs from '../../../tools/extension-wasm/lib/ocr.js';
import * as pptKeyJs from '../../../tools/extension-wasm/lib/ppt-key.js';
import * as priceSnapshotJs from '../../../tools/extension-wasm/lib/price-snapshot.js';
import * as pricingJs from '../../../tools/extension-wasm/lib/pricing.js';
import * as rectifyJs from '../../../tools/extension-wasm/lib/rectify.js';
import * as searchJs from '../../../tools/extension-wasm/lib/search.js';
import * as setChoiceJs from '../../../tools/extension-wasm/lib/set-choice.js';
import * as setupJs from '../../../tools/extension-wasm/lib/setup.js';
import * as sharedConfigJs from '../../../tools/extension-wasm/lib/shared-config.js';

import type {
  Box, CandidateView, CanvasLike, CatalogCard, Detection, Hit, ModelAsset, NumberRead, PriceFields, PriceGrid,
  PriceQuote, ScanRow, SetChoice, TitleVerdict,
} from './types';

type Meta = readonly CatalogCard[];
type SetSizes = unknown;
type Snapshot = unknown;
type ModelSource = string | ArrayBuffer | Uint8Array;

export interface ConfirmOptions {
  height?: number;
  contradicts?: ((name: string | undefined) => boolean) | null;
}

export interface ExportResult {
  rows: (string | number)[][];
  count: number;
  notIncluded: number;
  skipped: number;
  removed: number;
  total: number;
}

// Detection, crop and embedding (run on the ONNX runtime installed as globalThis.ort).
export const loadDetector = detectJs.loadDetector as (model: ModelSource) => Promise<void>;
export const detectCards = detectJs.detectCards as (photo: CanvasLike) => Promise<Detection[]>;
export const rectifyCard = rectifyJs.rectifyCard as (source: CanvasLike, box: Box) => CanvasLike;
export const loadEmbedder = embedJs.loadEmbedder as (model: ModelSource) => Promise<void>;
export const embedCard = embedJs.embedCard as (card: CanvasLike) => Promise<Float32Array>;

// Catalog search.
export const loadCatalog = searchJs.loadCatalog as (gzip: ArrayBuffer | Uint8Array) => Promise<void>;
export const searchCatalog = searchJs.searchCatalog as (query: Float32Array, topK?: number) => Hit[];
export const scoreIndices = searchJs.scoreIndices as (query: Float32Array, indices: readonly number[]) => Hit[];
export const physicalHits = searchJs.physicalHits as <T extends { index: number }>(hits: readonly T[], meta: Meta) => T[];
export const isCardBack = cardBackJs.isCardBack as (embedding: Float32Array, bestCatalogScore: number) => boolean;

// The confirm rule and what follows it.
export const fuseResults = fusionJs.fuseResults as (
  hits: readonly Hit[], ocrText: null, meta: Meta, idMap: null, options: ConfirmOptions,
) => Pick<ScanRow, 'identity' | 'confidence' | 'abstain' | 'reason' | 'choose'>;
export const markChoose = fusionJs.markChoose as (row: ScanRow, height: number) => ScanRow;
export const capUnconfirmedSet = fusionJs.capUnconfirmedSet as (row: ScanRow) => ScanRow;
export const informationHeight = fusionJs.informationHeight as (fedHeight: number, naturalPerFed: number) => number;
export const CONFIRM_MIN_HEIGHT = fusionJs.CONFIRM_MIN_HEIGHT as number;
export const SMALL_SOURCE_CONFIDENCE_CAP = fusionJs.SMALL_SOURCE_CONFIDENCE_CAP as number;

// Names, sets and the card's own text.
export const choiceName = setChoiceJs.choiceName as (name: string | undefined) => string;
export const choiceSummary = setChoiceJs.choiceSummary as (card: CatalogCard) => SetChoice;
export const setChoices = setChoiceJs.setChoices as (identity: CatalogCard, hits: readonly Hit[], meta: Meta) => CatalogCard[];
export const titleVerdict = setChoiceJs.titleVerdict as (
  name: string | null | undefined, text: string, knownNames: readonly string[],
) => TitleVerdict;
export const extendsTitle = setChoiceJs.extendsTitle as (name: string, titleName: string) => boolean;
export const setSizes = cardNumberJs.setSizes as (meta: Meta) => SetSizes;
export const printingByNumber = cardNumberJs.printingByNumber as (
  rows: readonly CatalogCard[], read: NumberRead, sizes: SetSizes,
) => number | null;
export const parseCardNumber = cardNumberJs.parseCardNumber as (lines: readonly string[]) => { number: string; total: number } | null;
export const loadNumberReader = ocrJs.loadNumberReader as (detector: ModelSource, recognizer: ModelSource) => Promise<void>;
export const numberReaderReady = ocrJs.numberReaderReady as () => boolean;
export const readCardName = ocrJs.readCardName as (card: CanvasLike) => Promise<string>;
export const readCardNumber = ocrJs.readCardNumber as (card: CanvasLike) => Promise<NumberRead | null>;

// The list the user chooses from.
export const closestMatches = cardPickerJs.closestMatches as (hits: readonly Hit[], meta: Meta, limit?: number) => CatalogCard[];
export const candidatesFor = cardPickerJs.candidatesFor as (row: ScanRow, meta: Meta, limit?: number) => CatalogCard[];
export const titleChoiceIds = cardPickerJs.titleChoiceIds as (hits: readonly Hit[], meta: Meta) => string[];
export const findCards = cardPickerJs.findCards as (meta: Meta, query: string, options?: { limit?: number }) => CatalogCard[];
export const thumbUrl = cardPickerJs.thumbUrl as (card: Partial<CatalogCard> | null | undefined) => string | null;
export const candidatesOfCard = chooseFlowJs.candidatesOfCard as (row: ScanRow) => CatalogCard[];
export const candidateView = chooseFlowJs.candidateView as (
  row: ScanRow, candidate: CatalogCard, options?: { best?: boolean },
) => CandidateView;
export const chooseState = chooseFlowJs.chooseState as (row: ScanRow) => 'confirmed' | 'choose' | 'back' | 'skipped';

// Prices.
export const getTcgdexCard = pricingJs.getTcgdexCard as (id: string) => Promise<unknown>;
export const getFullCardPayload = pricingJs.getFullCardPayload as (
  id: string,
) => Promise<{ tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, { market?: number; mid?: number }> } } | null>;
export const extractTcgPlayerId = pricingJs.extractTcgPlayerId as (url: string | undefined) => number | null;
export const getConditionGrid = conditionPricingJs.getConditionGrid as (
  identity: Partial<CatalogCard> & { tcgPlayerId?: number | null },
) => Promise<PriceGrid | null>;
export const fromTcgdexPayload = conditionPricingJs.fromTcgdexPayload as (card: unknown, identity: Partial<CatalogCard>) => PriceGrid | null;
export const fromPokemontcgPayload = conditionPricingJs.fromPokemontcgPayload as (
  prices: unknown, updatedAt?: string | null,
) => PriceGrid | null;
export const tcgPlayerIdFromTcgdex = conditionPricingJs.tcgPlayerIdFromTcgdex as (card: unknown) => number | null;
export const currentSnapshot = priceSnapshotJs.currentSnapshot as () => Promise<Snapshot | null>;
export const refreshPriceSnapshot = priceSnapshotJs.refreshPriceSnapshot as () => Promise<Snapshot | null>;
export const parseSnapshot = priceSnapshotJs.parseSnapshot as (text: string) => { v: 1; updatedAt: string; prices: Record<string, unknown> };
export const applySnapshot = priceSnapshotJs.applySnapshot as (grid: PriceGrid, snapshot: Snapshot | null) => PriceGrid;
export const applyCatalogPrices = priceSnapshotJs.applyCatalogPrices as (
  grid: PriceGrid | null, snapshot: Snapshot | null, identity: Partial<CatalogCard>,
) => PriceGrid | null;
export const getPptKey = pptKeyJs.getPptKey as () => Promise<string | null>;
export const savePptKey = pptKeyJs.savePptKey as (key: string) => Promise<void>;
export const clearPptKey = pptKeyJs.clearPptKey as () => Promise<void>;

// What a row shows.
export const listPrintings = cardDisplayJs.listPrintings as (grid: PriceGrid | null | undefined) => string[];
export const quotedPrice = cardDisplayJs.quotedPrice as (
  row: ScanRow, printing: string | null, conditions?: readonly string[],
) => PriceQuote | null;
export const formatUsd = cardDisplayJs.formatUsd as (amount: number) => string;
export const sourceFooter = cardDisplayJs.sourceFooter as (grid: PriceGrid | null | undefined, now?: number) => string | null;
export const isIdentified = cardDisplayJs.isIdentified as (row: ScanRow) => boolean;

// Export.
export const lotExportRows = lotExportJs.lotExportRows as (
  rows: readonly (ScanRow & PriceFields)[], choiceFor: (row: ScanRow) => string | null, conditions?: readonly string[], now?: number,
) => ExportResult;
export const lotToCsv = lotExportJs.lotToCsv as (rows: ExportResult['rows']) => string;
export const lotFileName = lotExportJs.lotFileName as (date?: Date) => string;

// Where the model files and the shared data live (GitHub releases), with their pinned hashes.
export const ASSETS = setupJs.ASSETS as readonly ModelAsset[];
export const OPTIONAL_ASSETS = setupJs.OPTIONAL_ASSETS as readonly ModelAsset[];
export const assetUrl = setupJs.assetUrl as (name: string) => string;
export const PRICE_SNAPSHOT_URL = sharedConfigJs.PRICE_SNAPSHOT_URL as string;
export const PACK_MANIFEST_URL = sharedConfigJs.PACK_MANIFEST_URL as string;
