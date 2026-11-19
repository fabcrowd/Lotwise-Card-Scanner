/**
 * Self-reload of an installed copy (lib/self-update.js, background.js "self-update"). Each test builds its own install in a
 * temp folder the way the installer lays it out (<tmp>/extension, fixed manifest key, so the installer's extension id),
 * loads it, then swaps in a newer copy the way tools/installer/install.ps1 does (rename extension -> extension.old,
 * extension.new -> extension) and checks what the running worker does.
 *
 * Playwright does not track an extension service worker that stopped or was reloaded, so nothing here evaluates in the
 * worker: state is read from extension pages opened for the purpose, and the worker is stopped over the DevTools protocol.
 *
 * Run: npx playwright test self-update --project=extension   (needs dist/extension-wasm: scripts/build-wasm-extension.ps1)
 */

import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_PAGE_URL } from '../../tools/extension-wasm/lib/self-update.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BUILD = path.join(ROOT, 'dist/extension-wasm');
const KEY = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/installer/extension-key.json'), 'utf8'));
const INSTALLER_ID = 'gppkiedgglhgagfmcnfebiccpkifbncm';

const isExt = (w) => w.url().startsWith('chrome-extension://');

function copyBuild(dest, { withKey, version }) {
  fs.cpSync(BUILD, dest, { recursive: true });
  const file = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (withKey) manifest.key = KEY.key;
  if (version) manifest.version = version;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return manifest;
}

// The installer's swap: extension -> extension.old, extension.new -> extension. If Windows refuses because the browser
// holds the folder, the exact error is recorded and the files are overwritten in place, manifest.json last.
function swapInstall(root, newVersion, { withKey }) {
  const ext = path.join(root, 'extension');
  const neu = path.join(root, 'extension.new');
  const old = path.join(root, 'extension.old');
  copyBuild(neu, { withKey, version: newVersion });
  try {
    fs.renameSync(ext, old);
    try {
      fs.renameSync(neu, ext);
    } catch (err) {
      fs.renameSync(old, ext); // undo the first step so the install is whole again
      throw err;
    }
    return { method: 'rename', error: null };
  } catch (err) {
    const error = `${err.code || ''} ${err.message}`;
    const files = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(neu);
    const manifestFile = path.join(neu, 'manifest.json');
    for (const f of files.filter((x) => x !== manifestFile)) {
      const target = path.join(ext, path.relative(neu, f));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(f, target);
    }
    fs.copyFileSync(manifestFile, path.join(ext, 'manifest.json'));
    return { method: 'overwrite-in-place', error };
  }
}

function bumped(version) {
  const parts = version.split('.');
  return parts.length < 4 ? `${version}.1` : `${parts.slice(0, 3).join('.')}.${Number(parts[3]) + 1}`;
}

test.describe('Self-reload of an installed copy', () => {
  let tmp;
  let context;
  let server;
  let port;
  let extId;
  let startVersion;
  // Every browser in this spec sends its outside traffic to this proxy, which records the attempt and refuses it. The
  // service worker's own fetch cannot be stubbed with page.route, so this is what guarantees nothing reaches GitHub.
  let proxy;
  let proxyPort;
  let proxySeen = [];

  test.beforeAll(async () => {
    server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>lot page</title><p>page</p>'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    // The browser's own background traffic (Google update checks and the like) comes here too and is refused the same way.
    proxy = http.createServer((req, res) => { proxySeen.push(req.url); res.writeHead(502); res.end(); });
    proxy.on('connect', (req, socket) => { proxySeen.push(req.url); socket.on('error', () => {}); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
    proxy.on('clientError', (err, socket) => socket.destroy());
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    proxyPort = proxy.address().port;
  });
  test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => { proxy.closeAllConnections?.(); proxy.close(resolve); });
  });
  test.beforeEach(() => { proxySeen = []; });
  test.afterEach(async () => {
    await context?.close().catch(() => {});
    context = null;
    // Chrome may still hold a file of its profile for a moment after the context closes; a leftover temp folder is not a failure.
    try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* left in the temp folder */ }
  });

  async function launch({ withKey }) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotwise-selfupdate-'));
    const root = path.join(tmp, 'install');
    fs.mkdirSync(root);
    startVersion = copyBuild(path.join(root, 'extension'), { withKey }).version;
    const extPath = path.join(root, 'extension');
    const profile = path.join(tmp, 'profile');
    context = await chromium.launchPersistentContext(profile, {
      headless: false, viewport: { width: 1000, height: 700 },
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, '--no-sandbox', `--proxy-server=http://127.0.0.1:${proxyPort}`],
    });
    const worker = context.serviceWorkers().find(isExt) || await context.waitForEvent('serviceworker', { predicate: isExt, timeout: 30_000 });
    extId = new URL(worker.url()).host;
    // Chrome disables an unpacked extension when it reloads unless Developer mode is on (the user has it on to load the
    // installer's copy). A hand-written profile preference is discarded by Chrome, so the switch is turned on in the page.
    const manager = await context.newPage();
    await manager.goto('chrome://extensions');
    await manager.locator('#devMode').click();
    await expect(manager.locator('#devMode')).toHaveAttribute('aria-pressed', 'true');
    await manager.close();
    return root;
  }

  // Reads from a fresh extension page. During a reload the page may not load: that reads as null.
  async function probe(fn, arg) {
    let page;
    try {
      page = await context.newPage();
      await page.goto(`chrome-extension://${extId}/options.html`, { timeout: 5000 });
      return await page.evaluate(fn, arg);
    } catch {
      return null;
    } finally {
      await page?.close().catch(() => {});
    }
  }
  const runningVersion = () => probe(() => chrome.runtime.getManifest().version);

  async function pagePair() {
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(`http://127.0.0.1:${port}/a`);
    await b.goto(`http://127.0.0.1:${port}/b`);
    return { a, b };
  }

  // Stops the real worker over the DevTools protocol, then wakes it by switching tabs (not by clicking the icon).
  async function stopAndWake({ a, b }) {
    const cdp = await context.newCDPSession(a);
    const log = [];
    let versionId = null;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const v of versions.filter((x) => x.scriptURL.startsWith(`chrome-extension://${extId}/`))) { versionId = v.versionId; log.push(v.runningStatus); }
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => log.at(-1)).toBe('running');
    // A worker that is busy (an open scanner window makes it load models) may refuse the first stop: ask again until it stops.
    await expect.poll(async () => {
      if (log.at(-1) !== 'running') return log.at(-1);
      await cdp.send('ServiceWorker.stopWorker', { versionId }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      return log.at(-1);
    }, { timeout: 60_000, message: 'the worker stopped' }).toBe('stopped');
    await b.bringToFront();
    await a.bringToFront();
    await expect.poll(() => log.slice(log.indexOf('stopped')).includes('starting'), { timeout: 30_000, message: 'the worker started again' }).toBe(true);
    await cdp.detach().catch(() => {});
  }

  async function openScanner() {
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/popup.html'), timeout: 15_000 });
    const opener = await context.newPage();
    await opener.goto(`chrome-extension://${extId}/options.html`);
    await opener.evaluate(async () => { await chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 500, height: 720, focused: false }); });
    const popup = await opened;
    await opener.close();
    await popup.waitForLoadState('domcontentloaded');
    return popup;
  }

  test('a. the loaded installer copy reports the installer id and its version', async () => {
    await launch({ withKey: true });
    expect(extId).toBe(INSTALLER_ID);
    expect(await runningVersion()).toBe(startVersion);
    expect(await probe(() => chrome.runtime.id)).toBe(INSTALLER_ID);
  });

  test('b. a newer copy swapped in the way the installer does it reloads the idle extension by itself', async () => {
    const root = await launch({ withKey: true });
    const pair = await pagePair();
    const newer = bumped(startVersion);
    const swap = swapInstall(root, newer, { withKey: true });
    test.info().annotations.push({ type: 'swap method', description: `${swap.method}${swap.error ? ` (rename failed: ${swap.error})` : ''}` });
    console.log(`[self-update spec] swap method: ${swap.method}${swap.error ? `; rename error: ${swap.error}` : ''}`);
    await stopAndWake(pair);
    // The wake above is a tab switch only: no icon click and no runtime message reaches the worker. Any message would count
    // as activity and stop the reload, and the probe page sends one (options.js), so the probe waits until the start-up
    // check has long finished.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await expect.poll(runningVersion, { timeout: 30_000, message: 'the new version is running' }).toBe(newer);
    const guard = await probe(async () => (await chrome.storage.local.get('selfUpdate')).selfUpdate);
    expect(guard.updatedTo).toBe(newer);
    expect(guard.reload).toBeUndefined();
  });

  test('c. with the scanner window open it does not reload by itself; the banner offers Restart now, which reloads and reopens the scanner once', async () => {
    const root = await launch({ withKey: true });
    const pair = await pagePair();
    const popup = await openScanner();
    await expect(popup.locator('#update-notice')).toBeHidden();
    const newer = bumped(startVersion);
    const swap = swapInstall(root, newer, { withKey: true });
    console.log(`[self-update spec] swap method: ${swap.method}${swap.error ? `; rename error: ${swap.error}` : ''}`);
    await stopAndWake(pair);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    expect(await runningVersion(), 'no silent reload while the scanner is open').toBe(startVersion);

    await popup.reload();
    await expect(popup.locator('#update-text')).toHaveText(`Lotwise ${newer} is installed. Restart Lotwise to finish updating. Restarting clears the current scan and your saved lots.`);
    await expect(popup.locator('#update-action')).toHaveText('Restart now');
    await pair.b.bringToFront(); // the page the scanner window comes back on
    // The setup wizard of a fresh profile covers the window; the click goes straight to the button.
    await popup.locator('#update-action').dispatchEvent('click');

    await expect.poll(runningVersion, { timeout: 30_000, message: 'the new version is running' }).toBe(newer);
    const reopened = await expect.poll(async () => {
      for (const p of context.pages()) {
        if (!p.url().includes('/popup.html') || p.isClosed()) continue;
        const text = await p.locator('#update-text').textContent({ timeout: 2000 }).catch(() => null);
        if (text) return text;
      }
      return null;
    }, { timeout: 30_000, message: 'the scanner is open again with the note' }).toBe(`Lotwise was updated to ${newer}.`);
    void reopened;
    const scanner = context.pages().find((p) => p.url().includes('/popup.html') && !p.isClosed());
    await scanner.reload();
    await scanner.waitForLoadState('domcontentloaded');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(scanner.locator('#update-notice')).toBeHidden();
  });

  // d. The loop guard (never reload twice for one target version, 60 s between reloads) is proved in tests/self-update.test.js:
  // a real failed reload cannot be produced from outside the browser.

  // i. An open Settings page makes the extension busy: the worker is woken by a tab switch, the newer copy is on disk, and
  // still nothing reloads. The page stays alive, on the old version, with what was typed into it.
  test('i. an open Settings page is never reloaded under the user, and keeps what was typed', async () => {
    const root = await launch({ withKey: true });
    const pair = await pagePair();
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extId}/options.html`);
    await settings.locator('#ppt-key').fill('typed-before-the-swap');
    const swap = swapInstall(root, bumped(startVersion), { withKey: true });
    console.log(`[self-update spec] swap method: ${swap.method}${swap.error ? `; rename error: ${swap.error}` : ''}`);
    await stopAndWake(pair);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(await settings.evaluate(() => chrome.runtime.getManifest().version), 'the page is alive and on the old version').toBe(startVersion);
    await expect(settings.locator('#ppt-key')).toHaveValue('typed-before-the-swap');
    expect(await runningVersion()).toBe(startVersion);
  });

  // j. Session storage is cleared by a reload: a saved lot or a held scan stops the silent reload, with no page open.
  const sessionSeeds = {
    'a saved lot': { lotSessions: { v: 1, lots: { 'https://lots.example/page': { savedAt: Date.now(), state: { cards: [{ name: 'x' }] } } } } },
    'a held scan within its age limit': { heldScan: { data: { scanId: 'held-1', cards: [{ identity: { id: 'x-1' }, crop: null }] }, url: 'https://lots.example/page', finishedAt: Date.now() - 60_000 } },
  };
  for (const [name, seedData] of Object.entries(sessionSeeds)) {
    test(`j. ${name} in session storage stops the silent reload`, async () => {
      const root = await launch({ withKey: true });
      const pair = await pagePair();
      await probe((data) => chrome.storage.session.set(data), seedData);
      const key = Object.keys(seedData)[0];
      expect(await probe(async (k) => k in (await chrome.storage.session.get(k)), key), 'the seed is stored').toBe(true);
      const swap = swapInstall(root, bumped(startVersion), { withKey: true });
      console.log(`[self-update spec] swap method: ${swap.method}${swap.error ? `; rename error: ${swap.error}` : ''}`);
      await stopAndWake(pair);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      expect(await runningVersion(), 'no silent reload while something is stored').toBe(startVersion);
      expect(await probe(async (k) => k in (await chrome.storage.session.get(k)), key), 'the seed is still there').toBe(true);
    });
  }

  // Part 2, the check for a newer release. The record is seeded with a check made an hour ago, so no automatic check is due and
  // the extension makes no request of its own. Navigations to github.com are stubbed. The worker's fetch cannot be stubbed, so
  // the unit tests with a fake fetch are the proof of the network path; the proxy above refuses anything that tries.
  const HOUR = 60 * 60 * 1000;
  const seed = async (record) => {
    await probe((r) => chrome.storage.local.set({ selfUpdate: r }), record);
    expect(await probe(async () => (await chrome.storage.local.get('selfUpdate')).selfUpdate), 'the record was seeded').toEqual(record);
  };
  const storedRecord = () => probe(async () => (await chrome.storage.local.get('selfUpdate')).selfUpdate);

  test('f. a newer release is offered in the scanner; Get the update opens the fixed release page; Not now hides it for good', async () => {
    await launch({ withKey: true });
    const newer = bumped(startVersion);
    let stubbed = 0;
    await context.route('https://github.com/**', (route) => { stubbed += 1; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub release page</title>' }); });
    const record = { latestVersion: newer, lastCheckAt: Date.now() - HOUR, lastCheckOk: true };
    await seed(record);

    const popup = await openScanner();
    await expect(popup.locator('#update-text')).toHaveText(`Lotwise ${newer} is available.`);
    await expect(popup.locator('#update-action')).toHaveText('Get the update');
    await expect(popup.locator('#update-skip')).toHaveText('Not now');

    const opened = context.waitForEvent('page', { timeout: 15_000 });
    await popup.locator('#update-action').dispatchEvent('click'); // the setup wizard of a fresh profile covers the window
    const tab = await opened;
    await expect.poll(() => tab.url(), { message: 'the tab shows the release page' }).toBe(RELEASE_PAGE_URL);
    expect(stubbed, 'the stub answered the tab (and nothing went to the network)').toBeGreaterThanOrEqual(1);
    await tab.close();

    await popup.locator('#update-skip').dispatchEvent('click');
    await expect(popup.locator('#update-notice')).toBeHidden();
    await expect.poll(async () => (await storedRecord())?.dismissedVersion).toBe(newer);
    await popup.reload();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(popup.locator('#update-notice')).toBeHidden();
    // The popup of a fresh profile may try to fetch its models from GitHub (the proxy refuses that too); what matters here is
    // that no release check ran: its first step is to record the attempt time, and the record only gained the dismissal.
    expect(await storedRecord(), 'no release check ran').toEqual({ ...record, dismissedVersion: newer });
  });

  test('g. Settings shows the installer copy\'s version and the newer release; a failed Check now says so and the button works again', async () => {
    await launch({ withKey: true });
    const newer = bumped(startVersion);
    await seed({ lastCheckAt: Date.now() - 2 * HOUR, lastCheckOk: true });
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extId}/options.html`);
    await expect(settings.locator('#updates-section')).toBeVisible();
    await expect(settings.locator('#updates-version')).toHaveText(`Lotwise ${startVersion}.`);
    await expect(settings.locator('#updates-status')).toHaveText(/^You have the latest version\. Last checked .+\.$/);
    await expect(settings.locator('#updates-get')).toBeHidden();

    await seed({ latestVersion: newer, lastCheckAt: Date.now() - 2 * HOUR, lastCheckOk: true });
    await settings.reload();
    await expect(settings.locator('#updates-status')).toHaveText(`Version ${newer} is available.`);
    await expect(settings.locator('#updates-get')).toBeVisible();

    await context.setOffline(true);
    await settings.locator('#updates-check').click();
    await expect(settings.locator('#updates-status')).toHaveText("Couldn't check for a new version. Try again later.");
    await expect(settings.locator('#updates-check')).toBeEnabled();
    expect((await storedRecord()).latestVersion, 'a failed check keeps the version it knew').toBe(newer);
    await context.setOffline(false);
  });

  test('h. a copy with another id shows no Updates block and no banner, and a seeded record changes nothing', async () => {
    await launch({ withKey: false });
    const newer = bumped(startVersion);
    const record = { latestVersion: newer, lastCheckAt: Date.now() - HOUR, lastCheckOk: true };
    await seed(record);
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extId}/options.html`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(settings.locator('#updates-section')).toBeHidden();
    const popup = await openScanner();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(popup.locator('#update-notice')).toBeHidden();
    expect(await probe(() => chrome.runtime.sendMessage({ action: 'selfUpdateSettings' }))).toEqual({ installer: false });
    expect(await probe(() => chrome.runtime.sendMessage({ action: 'selfUpdateCheckNow' }))).toEqual({ ok: false, latestVersion: null, checkedAt: null });
    expect(await probe(() => chrome.runtime.sendMessage({ action: 'selfUpdateOpenRelease' }))).toEqual({ ok: false });
    expect(await probe((v) => chrome.runtime.sendMessage({ action: 'selfUpdateDismiss', version: v }), newer)).toEqual({ ok: false });
    expect(await storedRecord(), 'the record is exactly as seeded').toEqual(record);
  });

  test('e. a copy with another id does nothing: no reload, no banner, no selfUpdate record', async () => {
    const root = await launch({ withKey: false });
    expect(extId).not.toBe(INSTALLER_ID);
    const pair = await pagePair();
    const swap = swapInstall(root, bumped(startVersion), { withKey: false });
    console.log(`[self-update spec] swap method: ${swap.method}${swap.error ? `; rename error: ${swap.error}` : ''}`);
    await stopAndWake(pair);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(await runningVersion()).toBe(startVersion);
    const popup = await openScanner();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(popup.locator('#update-notice')).toBeHidden();
    expect(await probe(async () => 'selfUpdate' in (await chrome.storage.local.get('selfUpdate')))).toBe(false);
    expect(await probe(() => chrome.runtime.sendMessage({ action: 'selfUpdateState' }))).toEqual({ diskVersion: null, updatedTo: null, reloadFailed: false, latestVersion: null });
  });
});
