import assert from 'node:assert/strict';
import test from 'node:test';
import { createScannerOpener } from '../tools/extension-wasm/lib/scanner-window.js';

// The toolbar button and a click on a page card both open the scanner window, or focus the one that is open.
// Two quick calls must give one window: the id is known only after windows.create resolves.

function fakeChrome({ existing = [] } = {}) {
  const calls = { create: [], update: [], targets: [] };
  let winId = null;
  let finishCreate;
  const opener = createScannerOpener({
    windows: {
      create: (options) => { calls.create.push(options); return new Promise((resolve) => { finishCreate = resolve; }); },
      update: async (id, options) => { calls.update.push([id, options]); },
    },
    getContexts: async () => existing,
    popupUrl: 'chrome-extension://x/popup.html',
    setTargetTab: (id) => calls.targets.push(id),
    isInternalUrl: (url) => Boolean(url) && url.startsWith('chrome://'),
    getWinId: () => winId,
    setWinId: (id) => { winId = id; },
  });
  return { opener, calls, finishCreate: (win) => finishCreate(win), winId: () => winId };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('two calls before windows.create resolves open one window; the second focuses it', async () => {
  const fake = fakeChrome();
  const first = fake.opener.open({ id: 4, url: 'https://shop.example/a' });
  const second = fake.opener.open({ id: 4, url: 'https://shop.example/a' });
  await tick();
  assert.equal(fake.calls.create.length, 1, 'one windows.create while the first is in flight');
  fake.finishCreate({ id: 77 });
  assert.deepEqual(await Promise.all([first, second]), [true, false], 'only the first opened a window');
  assert.equal(fake.calls.create.length, 1);
  assert.deepEqual(fake.calls.update, [[77, { focused: true }]]);
  assert.equal(fake.winId(), 77);
});

test('the scan target is the tab of the call, and an internal page is never the target', async () => {
  const fake = fakeChrome({ existing: [{ windowId: 9 }] });
  assert.equal(await fake.opener.open({ id: 5, url: 'https://shop.example/b' }), false, 'an existing window found after a restart is focused');
  assert.equal(await fake.opener.open({ id: 6, url: 'chrome://extensions' }), false);
  assert.deepEqual(fake.calls.targets, [5]);
  assert.equal(fake.calls.create.length, 0);
  assert.deepEqual(fake.calls.update, [[9, { focused: true }], [9, { focused: true }]]);
});

test('a failed first call does not block the next one', async () => {
  const fake = fakeChrome();
  const broken = createScannerOpener({
    windows: { create: async () => { throw new Error('no window'); }, update: async () => {} },
    getContexts: async () => [], popupUrl: 'p', setTargetTab() {}, isInternalUrl: () => false, getWinId: () => null, setWinId() {},
  });
  await assert.rejects(broken.open({ id: 1 }), /no window/);
  await assert.rejects(broken.open({ id: 1 }), /no window/, 'the second call still runs and fails on its own');
  assert.ok(fake.opener);
});

test('beforeCreate runs once, just before windows.create, and never when a window is only focused', async () => {
  const order = [];
  const fake = fakeChrome();
  const first = fake.opener.open({ id: 4, url: 'https://shop.example/a' }, async () => { order.push(`hook:${fake.calls.create.length}`); });
  const second = fake.opener.open({ id: 4, url: 'https://shop.example/a' }, async () => { order.push('hook-second'); });
  await tick();
  assert.deepEqual(order, ['hook:0'], 'the hook ran before the one create call');
  fake.finishCreate({ id: 5 });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['hook:0'], 'the second call only focused: its hook never ran');
  await fake.opener.open({ id: 4, url: 'https://shop.example/a' }, async () => { order.push('hook-third'); });
  assert.deepEqual(order, ['hook:0']);
});

test('beforeCreate does not run when an existing window is found', async () => {
  const fake = fakeChrome({ existing: [{ windowId: 9 }] });
  let ran = 0;
  assert.equal(await fake.opener.open({ id: 1, url: 'https://shop.example/a' }, async () => { ran += 1; }), false);
  assert.equal(ran, 0);
});

test('a failing beforeCreate does not stop the window from opening', async () => {
  const fake = fakeChrome();
  const opened = fake.opener.open({ id: 1, url: 'https://shop.example/a' }, async () => { throw new Error('storage down'); });
  await tick();
  fake.finishCreate({ id: 3 });
  assert.equal(await opened, true);
  assert.equal(fake.calls.create.length, 1);
});

test('when windows.create rejects after the hook ran, onCreateFailed runs once and the error still reaches the caller', async () => {
  const calls = [];
  const opener = createScannerOpener({
    windows: { create: async () => { throw new Error('no window'); }, update: async () => {} },
    getContexts: async () => [], popupUrl: 'p', setTargetTab() {}, isInternalUrl: () => false, getWinId: () => null, setWinId() {},
  });
  await assert.rejects(opener.open({ id: 1 }, async () => { calls.push('hook'); }, async () => { calls.push('failed'); }), /no window/);
  assert.deepEqual(calls, ['hook', 'failed']);
});

test('onCreateFailed does not run when the window opens or is only focused', async () => {
  const fake = fakeChrome();
  let ran = 0;
  const opened = fake.opener.open({ id: 1, url: 'https://shop.example/a' }, null, async () => { ran += 1; });
  await tick();
  fake.finishCreate({ id: 8 });
  await opened;
  await fake.opener.open({ id: 1, url: 'https://shop.example/a' }, null, async () => { ran += 1; });
  assert.equal(ran, 0);
});
