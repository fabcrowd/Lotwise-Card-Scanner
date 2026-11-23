import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  INSTALLER_EXTENSION_ID, RELOAD_MIN_GAP_MS, SELF_UPDATE_KEY,
  isInstallerCopy, parseVersion, compareVersions, isNewerVersion, isUsableManifest,
  decideSelfUpdate, settleAfterReload, guardWithReload, hasStoredSessionWork,
  VERSION_FILE_URL, RELEASE_PAGE_URL, RELEASE_CHECK_INTERVAL_MS, RELEASE_CHECK_MIN_GAP_MS, VERSION_FILE_MAX_BYTES, RELEASE_FINAL_HOSTS,
  parseVersionFile, releaseCheckDue, manualCheckAllowed, availableUpdate, releaseUrlAllowed, checkForRelease,
  workerIsIdle, clearsUpdatedNote, waitSettled, FLUSH_WAIT_MAX_MS,
} from '../tools/extension-wasm/lib/self-update.js';
import { STORE_HOSTS, stripDevBlocks } from '../scripts/lib/store-package.mjs';

const manifest = (version, extra = {}) => ({ manifest_version: 3, version, background: { service_worker: 'background.js' }, ...extra });
const NOW = 1_000_000_000_000;
const decide = (over = {}) => decideSelfUpdate({
  runningVersion: '1.0.0', diskManifest: manifest('1.1.0'), idle: true, guard: null, now: NOW, ...over,
});

test('the installer id is the id Chrome derives from the public key in extension-key.json', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../tools/installer/extension-key.json', import.meta.url), 'utf8'));
  const hex = crypto.createHash('sha256').update(Buffer.from(file.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
  assert.equal(id, INSTALLER_EXTENSION_ID);
  assert.equal(file.id, INSTALLER_EXTENSION_ID);
});

test('isInstallerCopy is true only for the installer id', () => {
  assert.equal(isInstallerCopy(INSTALLER_EXTENSION_ID), true);
  assert.equal(isInstallerCopy('abcdefghijklmnopabcdefghijklmnop'), false);
  assert.equal(isInstallerCopy(undefined), false);
  assert.equal(isInstallerCopy(''), false);
});

test('parseVersion accepts 1 to 4 integers of 0..65535 and nothing else', () => {
  assert.deepEqual(parseVersion('3'), [3, 0, 0, 0]);
  assert.deepEqual(parseVersion('3.10.0'), [3, 10, 0, 0]);
  assert.deepEqual(parseVersion('1.2.3.4'), [1, 2, 3, 4]);
  assert.deepEqual(parseVersion('0.0.0.65535'), [0, 0, 0, 65535]);
  for (const bad of ['', '1.2.3.4.5', '1.65536', '-1.0', '+1.0', '1..2', '1.', '.1', '1.a', ' 1.0', '1.0 ', '01.0', '1.02', '1e3', '1.0-beta', null, undefined, 3, {}]) {
    assert.equal(parseVersion(bad), null, `rejects ${JSON.stringify(bad)}`);
  }
});

test('compareVersions compares numerically; missing parts count as 0; invalid gives null', () => {
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('3.9.9', '3.10.0'), -1);
  assert.equal(compareVersions('1.0', '1.0.0.0'), 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.0.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('x', '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', undefined), null);
});

test('isNewerVersion is strict and never true for invalid input', () => {
  assert.equal(isNewerVersion('1.1.0', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('0.9.0', '1.0.0'), false);
  assert.equal(isNewerVersion('bad', '1.0.0'), false);
  assert.equal(isNewerVersion('1.1.0', 'bad'), false);
});

test('isUsableManifest needs manifest_version 3, a valid version and a service worker string', () => {
  assert.equal(isUsableManifest(manifest('1.0.0')), true);
  assert.equal(isUsableManifest(null), false);
  assert.equal(isUsableManifest('text'), false);
  assert.equal(isUsableManifest([]), false);
  assert.equal(isUsableManifest(manifest('1.0.0', { manifest_version: 2 })), false);
  assert.equal(isUsableManifest(manifest('v1')), false);
  assert.equal(isUsableManifest({ manifest_version: 3, version: '1.0.0' }), false);
  assert.equal(isUsableManifest({ manifest_version: 3, version: '1.0.0', background: { service_worker: '' } }), false);
  assert.equal(isUsableManifest({ manifest_version: 3, version: '1.0.0', background: { service_worker: 5 } }), false);
});

test('decide: reload when the disk is newer, idle and no guard', () => {
  assert.equal(decide(), 'reload');
});

test('decide: none when the disk version is equal, older, unusable or missing', () => {
  assert.equal(decide({ diskManifest: manifest('1.0.0') }), 'none');
  assert.equal(decide({ diskManifest: manifest('0.9.0') }), 'none');
  assert.equal(decide({ diskManifest: null }), 'none');
  assert.equal(decide({ diskManifest: manifest('2.0.0', { manifest_version: 2 }) }), 'none');
  assert.equal(decide({ diskManifest: { manifest_version: 3, version: '2.0.0' } }), 'none');
  assert.equal(decide({ runningVersion: 'junk' }), 'none');
  assert.equal(decide({ idle: false, diskManifest: manifest('1.0.0') }), 'none');
});

test('decide: notice when not idle', () => {
  assert.equal(decide({ idle: false }), 'notice');
});

test('decide loop guard: notice when a reload to this same disk version was already attempted', () => {
  const guard = { reload: { from: '1.0.0', to: '1.1.0', at: NOW - 10 * RELOAD_MIN_GAP_MS, reopen: false } };
  assert.equal(decide({ guard }), 'notice');
  assert.equal(decide({ guard, idle: false }), 'notice');
  // A newer target than the one that was attempted is allowed.
  assert.equal(decide({ guard, diskManifest: manifest('1.2.0') }), 'reload');
});

test('decide 60 s rule: notice when the last self-reload was less than 60 s ago, reload at 60 s', () => {
  assert.equal(decide({ guard: { lastReloadAt: NOW - 59_999 } }), 'notice');
  assert.equal(decide({ guard: { lastReloadAt: NOW - RELOAD_MIN_GAP_MS } }), 'reload');
  assert.equal(decide({ guard: { reload: { from: '0.9.0', to: '1.0.0', at: NOW - 5_000 } } }), 'notice');
});

test('decide: a damaged guard record does not block or throw', () => {
  assert.equal(decide({ guard: 'junk' }), 'reload');
  assert.equal(decide({ guard: { reload: 5, lastReloadAt: 'x' } }), 'reload');
});

test('decide: a stored last-reload time in the future (clock moved back) does not block a reload', () => {
  assert.equal(decide({ guard: { lastReloadAt: NOW + 5 * 60_000 } }), 'reload');
  assert.equal(decide({ guard: { reload: { from: '0.9.0', to: '1.0.0', at: NOW + 5 * 60_000 } } }), 'reload');
  assert.equal(decide({ guard: { lastReloadAt: NOW + 1 } }), 'reload');
  assert.equal(decide({ guard: { lastReloadAt: NOW } }), 'notice', 'a reload just now still blocks');
  assert.equal(decide({ guard: { lastReloadAt: NOW + 5 * 60_000, reload: { from: '1.0.0', to: '1.1.0', at: NOW + 5 * 60_000 } } }), 'notice', 'the same target is still never tried twice');
});

const idleState = (over = {}) => ({ activity: false, openContextCount: 0, popupWinId: null, scanRunning: false, drawActive: false, storedWork: false, ...over });

test('workerIsIdle: idle only when nothing is open, active, running or stored', () => {
  assert.equal(workerIsIdle(idleState()), true);
});

test('workerIsIdle: any open page of the extension (scanner, Settings, anything) is not idle', () => {
  assert.equal(workerIsIdle(idleState({ openContextCount: 1 })), false);
  assert.equal(workerIsIdle(idleState({ openContextCount: 3 })), false);
  assert.equal(workerIsIdle(idleState({ popupWinId: 7 })), false);
});

test('workerIsIdle: any message or click since the worker started is not idle', () => {
  assert.equal(workerIsIdle(idleState({ activity: true })), false);
});

test('workerIsIdle: a running scan, draw mode or stored work is not idle', () => {
  assert.equal(workerIsIdle(idleState({ scanRunning: true })), false);
  assert.equal(workerIsIdle(idleState({ drawActive: true })), false);
  assert.equal(workerIsIdle(idleState({ storedWork: true })), false);
});

test('workerIsIdle: an unknown answer counts as not idle', () => {
  assert.equal(workerIsIdle(idleState({ openContextCount: undefined })), false);
  assert.equal(workerIsIdle(idleState({ openContextCount: null })), false);
  assert.equal(workerIsIdle(idleState({ activity: undefined })), false);
  assert.equal(workerIsIdle(idleState({ storedWork: undefined })), false);
  assert.equal(workerIsIdle(undefined), false);
});

test('clearsUpdatedNote: only when the answer lets the scanner show the note (no newer disk version)', () => {
  assert.equal(clearsUpdatedNote('1.1.0', null), true);
  assert.equal(clearsUpdatedNote('1.1.0', '1.2.0'), false, 'the restart banner wins, so the note must survive');
  assert.equal(clearsUpdatedNote(null, null), false);
  assert.equal(clearsUpdatedNote(undefined, null), false);
  assert.equal(clearsUpdatedNote('', null), false);
});

test('checkForRelease: a response whose content-length is over the cap is cancelled', async () => {
  let cancelled = false;
  const response = {
    ok: true, url: VERSION_FILE_URL,
    headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(VERSION_FILE_MAX_BYTES + 1) : null) },
    body: { cancel: async () => { cancelled = true; }, getReader: () => { throw new Error('must not be read'); } },
  };
  const r = await runCheck({ response });
  assert.equal(r.ok, false);
  assert.equal(cancelled, true);
});

// A timer that only fires when the test says so.
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { pending.delete(id); },
    fireAll: () => { for (const [id, { fn }] of [...pending]) { pending.delete(id); fn(); } },
    pending,
  };
}

test('waitSettled: a promise that settles in time gives true, and the timer is cleared', async () => {
  const timers = fakeTimers();
  assert.equal(FLUSH_WAIT_MAX_MS, 15_000);
  assert.equal(await waitSettled(Promise.resolve('done'), FLUSH_WAIT_MAX_MS, timers), true);
  assert.equal(timers.pending.size, 0);
  assert.equal(await waitSettled(Promise.reject(new Error('flush failed')), FLUSH_WAIT_MAX_MS, fakeTimers()), true, 'a failed flush has settled too');
});

test('waitSettled: a promise that does not settle gives false when the time is up, with the right limit', async () => {
  const timers = fakeTimers();
  const result = waitSettled(new Promise(() => {}), FLUSH_WAIT_MAX_MS, timers);
  assert.equal([...timers.pending.values()][0].ms, FLUSH_WAIT_MAX_MS);
  timers.fireAll();
  assert.equal(await result, false);
});

test('guardWithReload records the attempt and keeps other fields', () => {
  const g = guardWithReload({ updatedTo: '0.9.0' }, { from: '1.0.0', to: '1.1.0', at: NOW, reopen: true });
  assert.deepEqual(g, { updatedTo: '0.9.0', reload: { from: '1.0.0', to: '1.1.0', at: NOW, reopen: true }, lastReloadAt: NOW });
  assert.deepEqual(guardWithReload(null, { from: '1.0.0', to: '1.1.0', at: NOW, reopen: false }).reload.reopen, false);
});

test('settleAfterReload: the running version equals the target, so the reload worked', () => {
  const guard = { reload: { from: '1.0.0', to: '1.1.0', at: NOW - 3000, reopen: true } };
  const r = settleAfterReload(guard, '1.1.0');
  assert.equal(r.succeeded, true);
  assert.equal(r.reopen, true);
  assert.deepEqual(r.guard, { updatedTo: '1.1.0', lastReloadAt: NOW - 3000 });
  assert.equal(settleAfterReload({ reload: { ...guard.reload, reopen: false } }, '1.1.0').reopen, false);
});

test('settleAfterReload: a different running version keeps the record untouched', () => {
  const guard = { reload: { from: '1.0.0', to: '1.1.0', at: NOW, reopen: true } };
  const r = settleAfterReload(guard, '1.0.0');
  assert.equal(r.succeeded, false);
  assert.equal(r.guard, guard);
  assert.equal(settleAfterReload(null, '1.0.0').succeeded, false);
  assert.equal(settleAfterReload({}, '1.0.0').succeeded, false);
});

test('hasStoredSessionWork sees a held scan, draw state, or a saved lot, and nothing else', async () => {
  const area = (data) => ({ get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])) });
  assert.equal(await hasStoredSessionWork(area({})), false);
  assert.equal(await hasStoredSessionWork(area({ popupWinId: 3, targetTabId: 4, lastScanEra: 'x' })), false);
  assert.equal(await hasStoredSessionWork(area({ lotSessions: { v: 1, lots: {} } })), false);
  assert.equal(await hasStoredSessionWork(area({ heldScan: { data: {} } })), true);
  assert.equal(await hasStoredSessionWork(area({ drawState: { tabId: 1 } })), true);
  assert.equal(await hasStoredSessionWork(area({ lotSessions: { v: 1, lots: { 'https://a/': { savedAt: 1, state: { cards: [] } } } } })), true);
});

test('hasStoredSessionWork treats a storage error as "something is stored" so nothing is lost', async () => {
  assert.equal(await hasStoredSessionWork({ get: async () => { throw new Error('boom'); } }), true);
  assert.equal(await hasStoredSessionWork(null), true);
});

test('the guard key is one name', () => {
  assert.equal(SELF_UPDATE_KEY, 'selfUpdate');
});

// ─── part 2: the check for a newer release ───

const GOOD_FILE = JSON.stringify({ product: 'Lotwise', version: '3.2.0' });
const HOUR = 60 * 60 * 1000;

test('the release constants are the fixed release tag, and the file address is covered by a store host pattern', () => {
  assert.equal(VERSION_FILE_URL, 'https://github.com/fabcrowd/pokemon-auto-lister/releases/download/installer/lotwise-version.json');
  assert.equal(RELEASE_PAGE_URL, 'https://github.com/fabcrowd/pokemon-auto-lister/releases/tag/installer');
  assert.equal(RELEASE_CHECK_INTERVAL_MS, 24 * HOUR);
  assert.equal(RELEASE_CHECK_MIN_GAP_MS, 60_000);
  assert.equal(VERSION_FILE_MAX_BYTES, 2048);
  const covered = (url) => STORE_HOSTS.some((pattern) => url.startsWith(pattern.replace(/\*$/, '')));
  assert.equal(covered(VERSION_FILE_URL), true, 'the version file is under a host the store build already allows');
});

test('the hosts a release download may end on come from the store host list', () => {
  const storeHostnames = STORE_HOSTS.map((pattern) => new URL(pattern.replace(/\*$/, '')).hostname);
  assert.deepEqual([...RELEASE_FINAL_HOSTS].sort(), ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
  for (const host of RELEASE_FINAL_HOSTS) assert.ok(storeHostnames.includes(host), `${host} is in STORE_HOSTS`);
});

test('parseVersionFile accepts the Lotwise version file and ignores other fields', () => {
  assert.equal(parseVersionFile(GOOD_FILE), '3.2.0');
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Lotwise', version: '3.2.0.1', url: 'https://evil.example/x', notes: 'hi' })), '3.2.0.1');
});

test('parseVersionFile rejects everything else', () => {
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Sweep', version: '3.2.0' })), null);
  assert.equal(parseVersionFile(JSON.stringify({ version: '3.2.0' })), null);
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Lotwise' })), null);
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Lotwise', version: 'v3.2.0' })), null);
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Lotwise', version: '03.2.0' })), null);
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Lotwise', version: 3.2 })), null);
  assert.equal(parseVersionFile(JSON.stringify([{ product: 'Lotwise', version: '3.2.0' }])), null);
  assert.equal(parseVersionFile('null'), null);
  assert.equal(parseVersionFile('"3.2.0"'), null);
  assert.equal(parseVersionFile('not json'), null);
  assert.equal(parseVersionFile(''), null);
  assert.equal(parseVersionFile(undefined), null);
  assert.equal(parseVersionFile(JSON.stringify({ product: 'Lotwise', version: '3.2.0', pad: 'x'.repeat(VERSION_FILE_MAX_BYTES) })), null);
});

test('parseVersionFile counts bytes, not characters, against the cap', () => {
  const edge = JSON.stringify({ product: 'Lotwise', version: '3.2.0', pad: '' });
  const room = VERSION_FILE_MAX_BYTES - Buffer.byteLength(edge);
  const fits = JSON.stringify({ product: 'Lotwise', version: '3.2.0', pad: 'x'.repeat(room) });
  assert.equal(Buffer.byteLength(fits), VERSION_FILE_MAX_BYTES);
  assert.equal(parseVersionFile(fits), '3.2.0');
  const wide = JSON.stringify({ product: 'Lotwise', version: '3.2.0', pad: 'é'.repeat(Math.ceil(room / 2) + 1) });
  assert.ok(wide.length <= VERSION_FILE_MAX_BYTES && Buffer.byteLength(wide) > VERSION_FILE_MAX_BYTES);
  assert.equal(parseVersionFile(wide), null);
});

test('releaseCheckDue: never, 23 h 59 m, 24 h, and a stored time in the future', () => {
  const now = 10 * 24 * HOUR;
  assert.equal(releaseCheckDue(undefined, now), true);
  assert.equal(releaseCheckDue(null, now), true);
  assert.equal(releaseCheckDue('x', now), true);
  assert.equal(releaseCheckDue(now - (24 * HOUR - 60_000), now), false);
  assert.equal(releaseCheckDue(now - 24 * HOUR, now), true);
  assert.equal(releaseCheckDue(now - 30 * HOUR, now), true);
  assert.equal(releaseCheckDue(now + 1, now), true);
});

test('manualCheckAllowed: not within 60 s of the last check; a time in the future does not block', () => {
  const now = 10 * 24 * HOUR;
  assert.equal(manualCheckAllowed(undefined, now), true);
  assert.equal(manualCheckAllowed(now - 59_999, now), false);
  assert.equal(manualCheckAllowed(now - RELEASE_CHECK_MIN_GAP_MS, now), true);
  assert.equal(manualCheckAllowed(now + 5000, now), true);
});

test('availableUpdate: only a version strictly newer than the running and the disk version, and not dismissed', () => {
  const base = { latestVersion: '3.2.0', runningVersion: '3.1.0', diskVersion: null, dismissedVersion: null };
  assert.equal(availableUpdate(base), '3.2.0');
  assert.equal(availableUpdate({ ...base, latestVersion: '3.1.0' }), null, 'equal to running');
  assert.equal(availableUpdate({ ...base, latestVersion: '3.0.9' }), null, 'older than running');
  assert.equal(availableUpdate({ ...base, diskVersion: '3.2.0' }), null, 'the disk already holds it: the restart banner wins');
  assert.equal(availableUpdate({ ...base, diskVersion: '3.3.0' }), null);
  assert.equal(availableUpdate({ ...base, diskVersion: '3.1.5' }), '3.2.0');
  assert.equal(availableUpdate({ ...base, dismissedVersion: '3.2.0' }), null, 'dismissed');
  assert.equal(availableUpdate({ ...base, dismissedVersion: '3.1.9' }), '3.2.0', 'an older dismissal does not hide a newer version');
  assert.equal(availableUpdate({ ...base, latestVersion: 'junk' }), null);
  assert.equal(availableUpdate({ ...base, latestVersion: null }), null);
  assert.equal(availableUpdate({ ...base, runningVersion: 'junk' }), null);
});

test('releaseUrlAllowed: https, no credentials, and a host the release download really ends on', () => {
  const ok = [
    VERSION_FILE_URL,
    'https://objects.githubusercontent.com/github-production-release-asset/1/2?x=1',
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/2?x=1',
  ];
  for (const url of ok) assert.equal(releaseUrlAllowed(url), true, url);
  const bad = [
    'http://github.com/fabcrowd/pokemon-auto-lister/releases/download/installer/lotwise-version.json',
    'https://evil.example/fabcrowd/pokemon-auto-lister/releases/download/installer/lotwise-version.json',
    'https://github.com.evil.example/fabcrowd/pokemon-auto-lister/releases/download/installer/x',
    'https://user:pw@objects.githubusercontent.com/x',
    'https://github.com/someone-else/repo/releases/download/installer/lotwise-version.json',
    'https://raw.githubusercontent.com/fabcrowd/pokemon-auto-lister/main/lotwise-version.json',
    'https://objects.githubusercontent.com:8443/x',
    '', 'junk', undefined,
  ];
  for (const url of bad) assert.equal(releaseUrlAllowed(url), false, String(url));
});

// A response as fetch returns it: headers, a streamed body and the final address.
function fakeResponse({ ok = true, status = 200, url = VERSION_FILE_URL, body = GOOD_FILE, headers = {}, chunk = 512 } = {}) {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  let cancelled = false;
  return {
    ok, status, url,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: { getReader: () => ({
      read: async () => {
        if (cancelled || offset >= bytes.length) return { done: true, value: undefined };
        const value = bytes.slice(offset, offset + chunk);
        offset += chunk;
        return { done: false, value };
      },
      cancel: async () => { cancelled = true; },
    }) },
    get bytesRead() { return Math.min(offset, bytes.length); },
  };
}

async function runCheck({ response, error, guard = {}, nowValue = 5_000_000 }) {
  const saved = [];
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (error) throw error;
    return response;
  };
  const result = await checkForRelease({ guard, fetchFn, now: () => nowValue, save: async (fields) => { saved.push(fields); } });
  return { ...result, saved, calls };
}

test('checkForRelease: success stores the version, after recording the attempt first', async () => {
  const r = await runCheck({ response: fakeResponse() });
  assert.equal(r.ok, true);
  assert.deepEqual(r.guard, { lastCheckAt: 5_000_000, lastCheckOk: true, latestVersion: '3.2.0' });
  assert.deepEqual(r.saved[0], { lastCheckAt: 5_000_000 }, 'the attempt time is saved before anything else');
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, VERSION_FILE_URL);
  assert.equal(r.calls[0].init.cache, 'no-store');
  assert.equal(r.calls[0].init.credentials, 'omit');
  assert.equal(r.calls[0].init.redirect, 'follow');
});

test('checkForRelease: the attempt time is saved before the request is made', async () => {
  const order = [];
  await checkForRelease({
    guard: {}, now: () => 7,
    save: async (fields) => { order.push(`save:${Object.keys(fields).join(',')}`); },
    fetchFn: async () => { order.push('fetch'); return fakeResponse(); },
  });
  assert.equal(order[0], 'save:lastCheckAt');
  assert.equal(order[1], 'fetch');
});

test('checkForRelease: failures keep the previous latestVersion, record the attempt, and never throw', async () => {
  const guard = { latestVersion: '3.1.5', lastCheckAt: 1, lastCheckOk: true };
  const cases = {
    '404': { response: fakeResponse({ ok: false, status: 404 }) },
    'network error': { error: new TypeError('Failed to fetch') },
    'foreign host after a redirect': { response: fakeResponse({ url: 'https://evil.example/lotwise-version.json' }) },
    'a plain-http final address': { response: fakeResponse({ url: 'http://objects.githubusercontent.com/x' }) },
    'oversize by header': { response: fakeResponse({ headers: { 'content-length': String(VERSION_FILE_MAX_BYTES + 1) } }) },
    'bad content': { response: fakeResponse({ body: '{"product":"Other","version":"9.9.9"}' }) },
    'not json': { response: fakeResponse({ body: '<html>rate limited</html>' }) },
  };
  for (const [name, input] of Object.entries(cases)) {
    const r = await runCheck({ ...input, guard });
    assert.equal(r.ok, false, name);
    assert.equal(r.guard.latestVersion, '3.1.5', `${name}: the old version stays`);
    assert.equal(r.guard.lastCheckAt, 5_000_000, `${name}: the attempt time is recorded`);
    assert.equal(r.guard.lastCheckOk, false, name);
    assert.ok(r.saved.every((fields) => !('latestVersion' in fields)), `${name}: nothing stored as the latest version`);
  }
});

test('checkForRelease: a body over the cap with no content-length header is cut off while reading', async () => {
  const body = JSON.stringify({ product: 'Lotwise', version: '3.2.0', pad: 'x'.repeat(100_000) });
  const response = fakeResponse({ body, chunk: 512 });
  const r = await runCheck({ response });
  assert.equal(r.ok, false);
  assert.ok(response.bytesRead <= VERSION_FILE_MAX_BYTES + 512, `read ${response.bytesRead} bytes, the cap is ${VERSION_FILE_MAX_BYTES}`);
});

test('checkForRelease: a response without a stream is read as text and still capped', async () => {
  const big = { ok: true, url: VERSION_FILE_URL, headers: { get: () => null }, text: async () => 'x'.repeat(VERSION_FILE_MAX_BYTES + 1) };
  assert.equal((await runCheck({ response: big })).ok, false);
  const small = { ok: true, url: VERSION_FILE_URL, headers: { get: () => null }, text: async () => GOOD_FILE };
  assert.equal((await runCheck({ response: small })).guard.latestVersion, '3.2.0');
});

test('checkForRelease: a storage failure does not throw, and the check still happens', async () => {
  const r = await checkForRelease({ guard: {}, now: () => 9, save: async () => { throw new Error('quota'); }, fetchFn: async () => fakeResponse() });
  assert.equal(r.ok, true);
  assert.equal(r.guard.latestVersion, '3.2.0');
});

test('the Updates block of the Settings page and its wiring survive the store transform', () => {
  const dir = new URL('../tools/extension-wasm/', import.meta.url);
  const html = stripDevBlocks(fs.readFileSync(new URL('options.html', dir), 'utf8'), 'options.html');
  const js = stripDevBlocks(fs.readFileSync(new URL('options.js', dir), 'utf8'), 'options.js');
  for (const id of ['updates-section', 'updates-version', 'updates-status', 'updates-get', 'updates-check']) {
    assert.ok(html.includes(`id="${id}"`), `options.html keeps #${id}`);
    assert.ok(js.includes(`"${id}"`), `options.js keeps the wiring of #${id}`);
  }
  for (const action of ['selfUpdateSettings', 'selfUpdateCheckNow', 'selfUpdateOpenRelease']) assert.ok(js.includes(action), `options.js still sends ${action}`);
  assert.ok(/id="updates-section"[^>]*\bhidden\b/.test(html), 'the block is hidden until the background says this is the installer copy');
  assert.ok(!/dev-only/.test(html + js));
});
