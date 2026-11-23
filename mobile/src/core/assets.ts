// The model and catalog files. They are the extension's own files, fetched from the same GitHub releases and checked
// against the same pinned SHA-256 hashes (lib/setup.js). A file is kept only after its hash matches.

import { ASSETS, OPTIONAL_ASSETS, PACK_MANIFEST_URL, PRICE_SNAPSHOT_URL, assetUrl } from './ext';
import type { ModelAsset } from './types';

/** The file operations the downloader needs. The app supplies the device's; the tests supply a fake. */
export interface ModelFiles {
  exists(name: string): boolean;
  download(url: string, name: string, onProgress?: (written: number, total: number) => void): Promise<void>;
  sha256(name: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): void;
  /** Every file name in the models folder. */
  list(): string[];
}

export interface DownloadProgress {
  file: string;
  fileIndex: number;
  totalFiles: number;
  bytesLoaded: number;
  bytesTotal: number;
}

const PARTIAL_SUFFIX = '.part';
const HASH_PREFIX_LENGTH = 16;

/**
 * The file's name on the device. It starts with the pinned hash, so when the extension pins a file to new contents
 * the old file of the same name is not trusted: the new one counts as missing and is fetched.
 */
export const storedName = (asset: ModelAsset): string => `${asset.sha256.slice(0, HASH_PREFIX_LENGTH)}-${asset.name}`;

export const hasAsset = (files: ModelFiles, asset: ModelAsset): boolean => files.exists(storedName(asset));

/** The pinned entry for a model file, by the name the extension gives it. */
export function assetNamed(name: string): ModelAsset {
  const asset = [...ASSETS, ...PHONE_OPTIONAL_ASSETS].find((entry) => entry.name === name);
  if (!asset) throw new Error(`Unknown model file: ${name}`);
  return asset;
}

/** The text reading models (engine.ts loads these two). */
export const TEXT_READING_FILES: readonly string[] = ['ocr_det.onnx', 'ocr_rec.onnx'];

/**
 * The optional files the phone reads. A file the extension later adds to OPTIONAL_ASSETS is neither downloaded nor
 * listed here until it is added to this list.
 */
export const PHONE_OPTIONAL_FILES: readonly string[] = [...TEXT_READING_FILES];

const PHONE_OPTIONAL_ASSETS: readonly ModelAsset[] = OPTIONAL_ASSETS.filter((asset) => PHONE_OPTIONAL_FILES.includes(asset.name));

export const requiredAssets = (): readonly ModelAsset[] => ASSETS;
export const optionalAssets = (): readonly ModelAsset[] => PHONE_OPTIONAL_ASSETS;

/** Whether every text reading file is on the device. */
export const textReadingReady = (files: ModelFiles): boolean =>
  PHONE_OPTIONAL_ASSETS.filter((asset) => TEXT_READING_FILES.includes(asset.name)).every((asset) => hasAsset(files, asset));

/** What to tell the user when optional files could not be fetched; says text reading only when a text file failed. */
export function optionalFailureNote(failed: readonly string[]): string | null {
  if (failed.length === 0) return null;
  if (failed.some((name) => TEXT_READING_FILES.includes(name))) {
    return 'Some optional text files could not be downloaded, so text reading stays off. Scanning still works.';
  }
  return `Could not download ${failed.join(', ')}. Scanning still works.`;
}

export function missingAssets(files: ModelFiles, assets: readonly ModelAsset[] = ASSETS): ModelAsset[] {
  return assets.filter((asset) => !hasAsset(files, asset));
}

export const modelsReady = (files: ModelFiles): boolean => missingAssets(files).length === 0;

/** "about 147 MB" for the files still to fetch. */
export function downloadSizeText(assets: readonly ModelAsset[]): string {
  const megabytes = Math.round(assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0) / 1_000_000);
  return megabytes < 1 ? 'under 1 MB' : `about ${megabytes} MB`;
}

async function fetchVerified(
  files: ModelFiles, asset: ModelAsset, onProgress?: (written: number, total: number) => void,
): Promise<void> {
  const partial = storedName(asset) + PARTIAL_SUFFIX;
  if (files.exists(partial)) files.remove(partial);
  await files.download(assetUrl(asset.name), partial, onProgress);
  const hash = (await files.sha256(partial)).toLowerCase();
  if (hash !== asset.sha256) {
    files.remove(partial);
    throw new Error(`${asset.name} did not match its expected hash, so it was not kept. Try the download again.`);
  }
  await files.rename(partial, storedName(asset));
}

/** Deletes what no current pin names: files of an older pin and unfinished downloads. */
export function removeStaleFiles(files: ModelFiles): void {
  const current = new Set([...ASSETS, ...PHONE_OPTIONAL_ASSETS].map(storedName));
  for (const name of files.list()) {
    if (!current.has(name)) files.remove(name);
  }
}

/** Fetches every missing required file. Throws on the first file that fails; files already verified are kept. */
export async function downloadModels(files: ModelFiles, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  const missing = missingAssets(files);
  for (const [fileIndex, asset] of missing.entries()) {
    const report = (bytesLoaded: number, bytesTotal: number): void =>
      onProgress?.({ file: asset.name, fileIndex, totalFiles: missing.length, bytesLoaded, bytesTotal });
    report(0, asset.bytes ?? 0);
    await fetchVerified(files, asset, (written, total) => report(written, total > 0 ? total : asset.bytes ?? 0));
  }
  removeStaleFiles(files);
}

/** The text models are optional: scanning works without them. Returns the names that could not be fetched. */
export async function downloadOptionalModels(files: ModelFiles): Promise<string[]> {
  const failed: string[] = [];
  for (const asset of missingAssets(files, PHONE_OPTIONAL_ASSETS)) {
    try {
      await fetchVerified(files, asset);
    } catch (err) {
      console.error('[models] optional file not fetched:', asset.name, err instanceof Error ? err.message : err);
      failed.push(asset.name);
    }
  }
  return failed;
}

export interface SourceStatus {
  name: string;
  url: string;
  ok: boolean;
  detail: string;
}

const CHECK_TIMEOUT_MS = 10000;

/** Whether each GitHub release the app reads from answers right now. Read-only: nothing is sent. */
export async function checkDataSources(fetchImpl: typeof fetch = fetch): Promise<SourceStatus[]> {
  const sources = [
    { name: 'Card models', url: assetUrl('id_map.json') },
    { name: 'Daily price file', url: PRICE_SNAPSHOT_URL },
    { name: 'Shared data pack', url: PACK_MANIFEST_URL },
  ];
  return Promise.all(sources.map(async ({ name, url }) => {
    try {
      const response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
      return { name, url, ok: response.ok, detail: response.ok ? 'Reachable' : `Answered ${response.status}` };
    } catch (err) {
      return { name, url, ok: false, detail: err instanceof Error ? err.message : 'No answer' };
    }
  }));
}
