// Installs the browser globals the extension's modules expect. Nothing here touches a native module, so the unit
// tests install the same adapters with in-memory stores. The app adds the native parts in ./native.ts.

import { gunzipSync } from 'fflate';

import { PixelCanvas, PixelImageData } from './canvas';
import { type KeyValueStore, type StorageArea, createStorageArea, memoryStore } from './storage';

export interface OrtGlobal {
  Tensor: unknown;
  InferenceSession: { create(model: unknown, options?: unknown): Promise<unknown> };
}

interface Globals {
  OffscreenCanvas?: unknown;
  ImageData?: unknown;
  DecompressionStream?: unknown;
  chrome?: { storage: { local: StorageArea; session: StorageArea; sync: StorageArea } };
  ort?: OrtGlobal;
}

const scope = globalThis as unknown as Globals;

/**
 * The slice of DecompressionStream that lib/search.js loadCatalog uses: write the gzip bytes, close, read once.
 * Hermes has no DecompressionStream. The catalog is inflated in one synchronous call when the reader first reads.
 */
export class GunzipStream {
  private readonly chunks: Uint8Array[] = [];
  private closed = false;
  private delivered = false;

  constructor(format: string) {
    if (format !== 'gzip') throw new Error(`Unsupported compression format: ${format}`);
  }

  /** The written bytes as one array. The catalog arrives as one chunk, which is used as it is (no second copy). */
  private joined(): Uint8Array {
    if (this.chunks.length === 1) return this.chunks[0];
    const all = new Uint8Array(this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of this.chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return all;
  }

  readonly writable = {
    getWriter: () => ({
      write: async (chunk: ArrayBuffer | Uint8Array): Promise<void> => {
        this.chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      },
      close: async (): Promise<void> => { this.closed = true; },
    }),
  };

  readonly readable = {
    getReader: () => ({
      read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (this.delivered || !this.closed) return { done: true };
        this.delivered = true;
        const packed = this.joined();
        this.chunks.length = 0;
        return { done: false, value: gunzipSync(packed) };
      },
    }),
  };
}

function installAbortTimeout(): void {
  const signal = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof signal.timeout === 'function') return;
  signal.timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

export interface PlatformOptions {
  /** chrome.storage.local. In the app: files on the device, with secrets in the keychain. */
  local?: KeyValueStore;
  /** The ONNX runtime, as the extension's `globalThis.ort`. */
  ort?: OrtGlobal;
}

export function installPlatform({ local = memoryStore(), ort }: PlatformOptions = {}): void {
  scope.OffscreenCanvas ??= PixelCanvas;
  scope.ImageData ??= PixelImageData;
  scope.DecompressionStream ??= GunzipStream;
  installAbortTimeout();
  scope.chrome = {
    storage: {
      local: createStorageArea(local),
      // session: gone when the app closes, as in the browser. sync: the phone has no browser sync; it stays empty.
      session: createStorageArea(memoryStore()),
      sync: createStorageArea(memoryStore()),
    },
  };
  if (ort) scope.ort = ort;
}
