// Developer build only (the store package leaves this file out). Boxes the user drew around cards the scanner missed,
// kept on this computer as training examples for the next offline retrain. Nothing here is ever uploaded or shared.
// Its own IndexedDB database, so it never shares an upgrade with the corrections.

const DB_NAME = "card-scanner-drawn-examples";
const EXAMPLES = "examples";
export const MAX_DRAWN_EXAMPLES = 200;
/** hidden: it filled a hidden not-a-card box; tooSmall: it filled a Too small box; missed: the scan had nothing there. */
export const DRAWN_KINDS = ["hidden", "tooSmall", "missed"];

/** Which kind a drawn box is, from the entry it replaced (null when it replaced none). */
export function drawnKind(replacedCard) {
  if (replacedCard?.notCard === true) return "hidden";
  if (replacedCard?.tooSmall === true) return "tooSmall";
  return "missed";
}

/** Ids sort by time, so the oldest example is the first key. */
export function newExampleId(ts = Date.now()) {
  return `${String(Math.trunc(ts)).padStart(15, "0")}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param idb an IndexedDB factory; the tests pass a small fake. */
export function createDrawnExamplesStore(idb = globalThis.indexedDB) {
  let opening = null;

  function open() {
    if (!idb) return Promise.reject(new Error("IndexedDB is not available here"));
    opening ??= new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EXAMPLES)) db.createObjectStore(EXAMPLES, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        const forget = () => { opening = null; };
        db.onclose = forget;
        db.onversionchange = () => { db.close(); forget(); };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((err) => {
      opening = null;
      throw err;
    });
    return opening;
  }

  async function attempt(mode, start) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EXAMPLES, mode);
      const request = start(tx.objectStore(EXAMPLES));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
  }

  // A connection the browser is closing throws InvalidStateError; a fresh one works.
  async function run(mode, start) {
    try {
      return await attempt(mode, start);
    } catch (err) {
      if (err?.name !== "InvalidStateError") throw err;
      opening = null;
      return attempt(mode, start);
    }
  }

  return {
    /** Stores the example (with an id made for it when it has none) and drops the oldest past the cap. Resolves its id. */
    async add(example) {
      const record = { ...example, id: example.id ?? newExampleId(example.ts) };
      await run("readwrite", (store) => {
        const saved = store.put(record);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          const oldestFirst = [...keys.result].sort();
          for (const key of oldestFirst.slice(0, Math.max(0, oldestFirst.length - MAX_DRAWN_EXAMPLES))) store.delete(key);
        };
        return saved;
      });
      return record.id;
    },
    /** True when the example exists and now has the kind. */
    async setKind(id, kind) {
      const found = await run("readwrite", (store) => {
        const got = store.get(id);
        got.onsuccess = () => { if (got.result) store.put({ ...got.result, kind }); };
        return got;
      });
      return Boolean(found);
    },
    /** Oldest first. */
    async list() {
      return (await run("readonly", (store) => store.getAll())).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    count: () => run("readonly", (store) => store.count()),
    clear: () => run("readwrite", (store) => store.clear()),
  };
}
