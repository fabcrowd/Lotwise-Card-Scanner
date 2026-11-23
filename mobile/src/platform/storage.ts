// chrome.storage for the extension's modules (lib/pricing.js, price-snapshot.js, ppt-key.js), backed by whatever
// key-value store the app supplies. Both calling styles the extension uses are supported: a callback, or a promise.

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type Items = Record<string, unknown>;
type Keys = string | readonly string[] | Items | null | undefined;

export interface StorageArea {
  get(keys?: Keys, callback?: (items: Items) => void): Promise<Items> | undefined;
  set(items: Items, callback?: () => void): Promise<void> | undefined;
  remove(keys: string | readonly string[], callback?: () => void): Promise<void> | undefined;
}

export function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

/** Keys listed in `secureKeys` go to `secure` (the device keychain in the app); everything else to `plain`. */
export function routedStore(secureKeys: readonly string[], secure: KeyValueStore, plain: KeyValueStore): KeyValueStore {
  const pick = (key: string): KeyValueStore => (secureKeys.includes(key) ? secure : plain);
  return {
    getItem: (key) => pick(key).getItem(key),
    setItem: (key, value) => pick(key).setItem(key, value),
    removeItem: (key) => pick(key).removeItem(key),
  };
}

function namesAndDefaults(keys: Keys): { names: string[]; defaults: Items } {
  if (typeof keys === 'string') return { names: [keys], defaults: {} };
  if (Array.isArray(keys)) return { names: [...keys], defaults: {} };
  if (keys && typeof keys === 'object') return { names: Object.keys(keys), defaults: keys as Items };
  // chrome.storage returns every stored item for null. No extension module the app imports asks for that.
  return { names: [], defaults: {} };
}

function settle<T>(work: Promise<T>, callback: ((value: T) => void) | undefined): Promise<T> | undefined {
  if (!callback) return work;
  work.then(callback, (err: unknown) => {
    console.error('[storage] request failed:', err instanceof Error ? err.message : err);
  });
  return undefined;
}

export function createStorageArea(store: KeyValueStore): StorageArea {
  async function read(keys: Keys): Promise<Items> {
    const { names, defaults } = namesAndDefaults(keys);
    const out: Items = {};
    for (const name of names) {
      const raw = await store.getItem(name);
      if (raw == null) {
        if (name in defaults) out[name] = defaults[name];
        continue;
      }
      try {
        out[name] = JSON.parse(raw);
      } catch {
        // A damaged record reads as missing, the same as an entry that was never written.
        if (name in defaults) out[name] = defaults[name];
      }
    }
    return out;
  }
  async function write(items: Items): Promise<void> {
    for (const [name, value] of Object.entries(items)) await store.setItem(name, JSON.stringify(value));
  }
  async function erase(keys: string | readonly string[]): Promise<void> {
    for (const name of typeof keys === 'string' ? [keys] : keys) await store.removeItem(name);
  }
  return {
    get: (keys, callback) => settle(read(keys), callback),
    set: (items, callback) => settle(write(items), callback),
    remove: (keys, callback) => settle(erase(keys), callback),
  };
}
