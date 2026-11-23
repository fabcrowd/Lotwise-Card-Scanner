// The device's folders: the model files, the kept card pictures and the library file.

import { Directory, File, Paths } from 'expo-file-system';

import type { ModelFiles } from '../core/assets';
import { createLibrary } from '../data/library';
import { fileStore } from '../platform/native';

const modelDirectory = new Directory(Paths.document, 'models');
const cropDirectory = new Directory(Paths.document, 'cards');

const ensure = (directory: Directory): void => {
  if (!directory.exists) directory.create({ intermediates: true });
};

export const modelFile = (name: string): File => new File(modelDirectory, name);

/** A plain, decoded file path for the native ONNX runtime, which opens the string as given (it does not decode %20). */
export const modelPath = (name: string): string => decodeURI(modelFile(name).uri.replace(/^file:\/\//, ''));

export const deviceModelFiles: ModelFiles = {
  exists: (name) => modelFile(name).exists,
  download: async (url, name, onProgress) => {
    ensure(modelDirectory);
    await File.downloadFileAsync(url, modelFile(name), {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress?.(bytesWritten, totalBytes),
    });
  },
  sha256: (name) => modelFile(name).digest('SHA-256'),
  rename: async (from, to) => {
    const target = modelFile(to);
    if (target.exists) target.delete();
    await modelFile(from).move(target);
  },
  remove: (name) => {
    const file = modelFile(name);
    if (file.exists) file.delete();
  },
  list: () => (modelDirectory.exists ? modelDirectory.list().filter((entry) => entry instanceof File).map((entry) => entry.name) : []),
};

/** Moves a card picture out of the cache, which the system may clear, into the app's own folder. */
export async function keepCrop(uri: string | null, key: string): Promise<string | null> {
  if (!uri) return null;
  try {
    ensure(cropDirectory);
    const kept = new File(cropDirectory, `${key}.jpg`);
    if (kept.exists) kept.delete();
    await new File(uri).copy(kept);
    return kept.uri;
  } catch (err) {
    console.error('[files] card picture not kept:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function dropCrop(uri: string | null): void {
  if (!uri) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

/** Writes text to the cache and returns its address, for the share sheet. */
export async function writeShareFile(name: string, text: string): Promise<string> {
  const file = new File(Paths.cache, name);
  if (!file.exists) file.create();
  await file.write(text);
  return file.uri;
}

export const library = createLibrary(fileStore('library'));
