// The device-backed half of the platform adapters: files, the keychain and the native ONNX runtime.
// Imported once, first, by index.ts.

import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import { type OrtGlobal, installPlatform } from './install';
import { type KeyValueStore, routedStore } from './storage';

// lib/ppt-key.js keeps the user's price-service key under this name. It is the only secret the app holds.
const SECRET_KEYS = ['pptApiKey'] as const;

/** One file per key. Values can be several megabytes (the daily price file), too large for a key-value database row. */
export function fileStore(folder: string): KeyValueStore {
  const directory = new Directory(Paths.document, folder);
  const fileFor = (key: string): File => new File(directory, `${encodeURIComponent(key)}.json`);
  return {
    getItem: async (key) => {
      const file = fileFor(key);
      return file.exists ? file.text() : null;
    },
    setItem: async (key, value) => {
      if (!directory.exists) directory.create({ intermediates: true });
      const file = fileFor(key);
      if (!file.exists) file.create();
      await file.write(value);
    },
    removeItem: async (key) => {
      const file = fileFor(key);
      if (file.exists) file.delete();
    },
  };
}

const keychain: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

interface SessionOptions {
  executionProviders?: readonly unknown[];
  [option: string]: unknown;
}

/** The extension asks for the "wasm" provider, which exists only in a browser. The phone uses the runtime's default (CPU). */
function nativeOptions(options?: SessionOptions): SessionOptions | undefined {
  if (!options) return undefined;
  const { executionProviders, ...rest } = options;
  const kept = executionProviders?.filter((provider) => provider !== 'wasm') ?? [];
  return kept.length ? { ...rest, executionProviders: kept } : rest;
}

const ort: OrtGlobal = {
  Tensor,
  InferenceSession: {
    // `model` is a file path on the phone: an 89 MB model is never copied into JavaScript memory.
    create: (model, options) =>
      InferenceSession.create(model as string, nativeOptions(options as SessionOptions) as InferenceSession.SessionOptions),
  },
};

installPlatform({ local: routedStore(SECRET_KEYS, keychain, fileStore('storage')), ort });
