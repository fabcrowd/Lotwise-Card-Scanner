import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clearPptKey, getPptKey, migratePptKey, savePptKey } from '../tools/extension-wasm/lib/ppt-key.js';

function fakeArea(initial = {}, { failSet = false } = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      if (failSet) throw new Error('quota');
      Object.assign(data, items);
    },
    remove: async (key) => { delete data[key]; },
  };
}

test('a key in sync is copied to local and removed from sync', async () => {
  const sync = fakeArea({ pptApiKey: 'abc' });
  const local = fakeArea();
  assert.deepEqual(await migratePptKey(sync, local), { migrated: true });
  assert.equal(local.data.pptApiKey, 'abc');
  assert.equal('pptApiKey' in sync.data, false);
});

test('with no key in sync nothing is written', async () => {
  const sync = fakeArea();
  const local = fakeArea();
  assert.deepEqual(await migratePptKey(sync, local), { migrated: false });
  assert.deepEqual(local.data, {});
});

test('a key already in local wins, and the sync copy is still removed', async () => {
  const sync = fakeArea({ pptApiKey: 'old' });
  const local = fakeArea({ pptApiKey: 'new' });
  await migratePptKey(sync, local);
  assert.equal(local.data.pptApiKey, 'new');
  assert.equal('pptApiKey' in sync.data, false);
});

test('if the local write fails the sync copy is kept', async () => {
  const sync = fakeArea({ pptApiKey: 'abc' });
  const local = fakeArea({}, { failSet: true });
  await assert.rejects(migratePptKey(sync, local), /quota/);
  assert.equal(sync.data.pptApiKey, 'abc');
});

test('migrating twice is harmless', async () => {
  const sync = fakeArea({ pptApiKey: 'abc' });
  const local = fakeArea();
  await migratePptKey(sync, local);
  assert.deepEqual(await migratePptKey(sync, local), { migrated: false });
  assert.equal(local.data.pptApiKey, 'abc');
});

test('reading the key migrates first, then reads local', async () => {
  const storage = { sync: fakeArea({ pptApiKey: 'abc' }), local: fakeArea() };
  assert.equal(await getPptKey(storage), 'abc');
  assert.equal('pptApiKey' in storage.sync.data, false);
});

test('a sync area that throws does not hide the local key', async () => {
  const storage = {
    sync: { get: async () => { throw new Error('sync off'); }, remove: async () => {}, set: async () => {} },
    local: fakeArea({ pptApiKey: 'kept' }),
  };
  assert.equal(await getPptKey(storage), 'kept');
});

test('save writes to local only; clear removes it everywhere', async () => {
  const storage = { sync: fakeArea({ pptApiKey: 'stale' }), local: fakeArea() };
  await savePptKey('fresh', storage);
  assert.equal(storage.local.data.pptApiKey, 'fresh');
  assert.equal('pptApiKey' in storage.sync.data, false);
  await clearPptKey(storage);
  assert.equal(await getPptKey(storage), null);
});

import { clearPriceCache, PRICE_CACHE_PREFIX } from '../tools/extension-wasm/lib/batch-price.js';

test('finding 21: clearPriceCache removes the hour-long price entries and nothing else', async () => {
  const data = { [`${PRICE_CACHE_PREFIX}a`]: { ts: 1 }, [`${PRICE_CACHE_PREFIX}b`]: { ts: 1 }, pptApiKey: 'k', other: 1 };
  const storage = {
    get: async (keys) => (keys === null ? { ...data } : {}),
    remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
  };
  await clearPriceCache(storage);
  assert.deepEqual(Object.keys(data).sort(), ['other', 'pptApiKey']);
});

test('finding 21: the options page clears the price cache after saving or clearing the key', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../tools/extension-wasm/options.js', import.meta.url), 'utf8');
  assert.match(src, /await savePptKey\(key\);\s*await clearPriceCache\(chrome\.storage\.local\)/);
  assert.match(src, /await clearPptKey\(\);\s*await clearPriceCache\(chrome\.storage\.local\)/);
});
