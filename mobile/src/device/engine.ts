// Loads the models once and scans a photo: find the cards, crop each, recognize it.

import { assetNamed, hasAsset, modelsReady, storedName } from '../core/assets';
import {
  detectCards, embedCard, informationHeight, loadCatalog, loadDetector, loadEmbedder, loadNumberReader, readCardName,
  readCardNumber, rectifyCard,
} from '../core/ext';
import { type Recognizer, createRecognizer } from '../core/recognize';
import type { Box, CatalogCard, Detection, ScanRow } from '../core/types';
import { deviceModelFiles, modelFile, modelPath } from './files';
import { type Photo, cropCard, decodePhoto } from './photo';

export interface ScannedCard {
  id: string;
  row: ScanRow;
  /** The card's height in the pixels the matcher was given. */
  height: number;
  cropUri: string | null;
}

export interface Engine {
  recognizer: Recognizer;
  meta: readonly CatalogCard[];
  /** The card's name and number can be read (the optional text models are present). */
  readsText: boolean;
}

// A photo of a binder page or a spread of cards; more than this is a pile nobody confirms one by one.
const MAX_CARDS = 30;

export class ModelsMissingError extends Error {
  constructor() {
    super('The card models are not downloaded yet. Open Settings and download them first.');
    this.name = 'ModelsMissingError';
  }
}

let loading: Promise<Engine> | null = null;

/** Where a model file is on the device, by the name the extension gives it. */
const stored = (name: string): string => storedName(assetNamed(name));

async function loadTextReader(): Promise<boolean> {
  const [detector, recognizer] = [assetNamed('ocr_det.onnx'), assetNamed('ocr_rec.onnx')];
  if (!hasAsset(deviceModelFiles, detector) || !hasAsset(deviceModelFiles, recognizer)) return false;
  try {
    await loadNumberReader(modelPath(storedName(detector)), modelPath(storedName(recognizer)));
    return true;
  } catch (err) {
    // Scanning works without the text models; the card's name and number are then not read.
    console.error('[engine] text models not loaded:', err instanceof Error ? err.message : err);
    return false;
  }
}

async function load(): Promise<Engine> {
  if (!modelsReady(deviceModelFiles)) throw new ModelsMissingError();
  await loadDetector(modelPath(stored('card_detect.onnx')));
  await loadEmbedder(modelPath(stored('clip_visual_int8.onnx')));
  await loadCatalog(await modelFile(stored('catalog.bin.gz')).bytes());
  const meta = JSON.parse(await modelFile(stored('meta.json')).text()) as CatalogCard[];
  const readsText = await loadTextReader();
  const recognizer = createRecognizer({
    meta,
    embed: embedCard,
    readName: readsText ? readCardName : undefined,
    readNumber: readsText ? readCardNumber : undefined,
    log: (message) => console.warn('[engine]', message),
  });
  return { recognizer, meta, readsText };
}

/** The loaded engine. A failed load is forgotten, so the next call tries again. */
export function loadEngine(): Promise<Engine> {
  loading ??= load().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** Forget the loaded models, after the files changed on disk. */
export function resetEngine(): void {
  loading = null;
}

/** Top to bottom, then left to right, treating cards whose tops are within half a card height as one row. */
function readingOrder(detections: readonly Detection[]): Detection[] {
  if (!detections.length) return [];
  const heights = detections.map(({ box }) => box[3] - box[1]).sort((a, b) => a - b);
  const rowStep = Math.max(1, heights[Math.floor(heights.length / 2)] / 2);
  const rowOf = ({ box }: Detection): number => Math.round(box[1] / rowStep);
  return [...detections].sort((a, b) => rowOf(a) - rowOf(b) || a.box[0] - b.box[0]);
}

export async function scanPhoto(photo: Photo): Promise<ScannedCard[]> {
  const { recognizer } = await loadEngine();
  const { canvas, scale } = await decodePhoto(photo);
  const found = (await detectCards(canvas)).sort((a, b) => b.score - a.score).slice(0, MAX_CARDS);
  const stamp = Date.now();
  const cards: ScannedCard[] = [];
  for (const [index, { box }] of readingOrder(found).entries()) {
    // The work below runs on the same thread as the screen; a pause between cards keeps the progress spinner moving.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const cardBox: Box = [box[0], box[1], box[2], box[3]];
    // The crop comes from the decoded copy, so that copy's pixels are what the matcher sees.
    const height = informationHeight(cardBox[3] - cardBox[1], 1 / scale);
    const row = await recognizer.recognize(rectifyCard(canvas, cardBox), height);
    if (row.cardBack) continue;
    cards.push({ id: `${stamp}-${index}`, row, height, cropUri: await cropCard(photo, cardBox, scale) });
  }
  return cards;
}
