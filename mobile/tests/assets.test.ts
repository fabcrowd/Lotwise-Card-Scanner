// The download service against a mocked GitHub: no network, no disk.

import {
  type ModelFiles, checkDataSources, downloadModels, downloadOptionalModels, downloadSizeText, hasAsset, missingAssets,
  modelsReady, optionalAssets, removeStaleFiles, requiredAssets, storedName,
} from '../src/core/assets';
import { installPlatform } from '../src/platform/install';

const RELEASES = 'https://github.com/fabcrowd/pokemon-auto-lister/releases/download/';

interface FakeGitHub {
  files: ModelFiles;
  stored: Map<string, string>;
  requested: string[];
}

/** `hashFor(url)` is the hash the downloaded bytes will have; by default the pinned one, so the file verifies. */
function fakeGitHub(hashFor: (name: string) => string | Error = pinnedHash): FakeGitHub {
  const stored = new Map<string, string>();
  const requested: string[] = [];
  const files: ModelFiles = {
    exists: (name) => stored.has(name),
    download: async (url, name, onProgress) => {
      requested.push(url);
      const hash = hashFor(assetStoredAs(name.replace(/\.part$/, '')));
      if (hash instanceof Error) throw hash;
      onProgress?.(50, 100);
      onProgress?.(100, 100);
      stored.set(name, hash);
    },
    sha256: async (name) => stored.get(name) ?? '',
    rename: async (from, to) => {
      stored.set(to, stored.get(from) ?? '');
      stored.delete(from);
    },
    remove: (name) => { stored.delete(name); },
    list: () => [...stored.keys()],
  };
  return { files, stored, requested };
}

const everyAsset = () => [...requiredAssets(), ...optionalAssets()];

/** The extension's name for the file kept under this device name. */
function assetStoredAs(deviceName: string): string {
  const asset = everyAsset().find((entry) => storedName(entry) === deviceName);
  if (!asset) throw new Error(`no pinned file is stored as ${deviceName}`);
  return asset.name;
}

function pinnedHash(name: string): string {
  const asset = [...requiredAssets(), ...optionalAssets()].find((entry) => entry.name === name);
  if (!asset) throw new Error(`unknown asset ${name}`);
  return asset.sha256;
}

beforeAll(() => installPlatform());

test('every required file is fetched from the pinned GitHub release and kept once verified', async () => {
  const github = fakeGitHub();
  expect(modelsReady(github.files)).toBe(false);
  await downloadModels(github.files);
  expect(modelsReady(github.files)).toBe(true);
  expect(github.requested).toHaveLength(requiredAssets().length);
  for (const url of github.requested) expect(url.startsWith(RELEASES)).toBe(true);
  expect([...github.stored.keys()].some((name) => name.endsWith('.part'))).toBe(false);
});

test('a file whose hash does not match is deleted, not kept', async () => {
  const bad = requiredAssets()[0];
  const github = fakeGitHub((name) => (name === bad.name ? 'f'.repeat(64) : pinnedHash(name)));
  await expect(downloadModels(github.files)).rejects.toThrow(/did not match its expected hash/);
  expect(hasAsset(github.files, bad)).toBe(false);
  expect(github.stored.size).toBe(0);
  expect(modelsReady(github.files)).toBe(false);
});

test('an upper-case hash from the device still verifies', async () => {
  const github = fakeGitHub((name) => pinnedHash(name).toUpperCase());
  await downloadModels(github.files);
  expect(modelsReady(github.files)).toBe(true);
});

test('files already on the device are not fetched again, and a stale partial file is replaced', async () => {
  const github = fakeGitHub();
  const [first, second] = requiredAssets();
  github.stored.set(storedName(first), first.sha256);
  github.stored.set(`${storedName(second)}.part`, 'half a file');
  await downloadModels(github.files);
  expect(github.requested.some((url) => url.endsWith(`/${first.name}`))).toBe(false);
  expect(github.stored.get(storedName(second))).toBe(second.sha256);
});

test('progress names the file, its place in the queue and the bytes', async () => {
  const github = fakeGitHub();
  const seen: string[] = [];
  await downloadModels(github.files, (p) => seen.push(`${p.file} ${p.fileIndex + 1}/${p.totalFiles} ${p.bytesLoaded}/${p.bytesTotal}`));
  const first = requiredAssets()[0];
  expect(seen[0]).toBe(`${first.name} 1/${requiredAssets().length} 0/${first.bytes ?? 0}`);
  expect(seen).toContain(`${first.name} 1/${requiredAssets().length} 100/100`);
});

test('a network failure on a required file stops the download and keeps what was verified', async () => {
  const failing = requiredAssets()[1].name;
  const github = fakeGitHub((name) => (name === failing ? new Error('Network request failed') : pinnedHash(name)));
  await expect(downloadModels(github.files)).rejects.toThrow('Network request failed');
  expect(hasAsset(github.files, requiredAssets()[0])).toBe(true);
  expect(missingAssets(github.files).map((asset) => asset.name)).toContain(failing);
});

test('optional files that fail are reported by name and do not throw', async () => {
  const failing = optionalAssets()[0].name;
  const github = fakeGitHub((name) => (name === failing ? new Error('offline') : pinnedHash(name)));
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(downloadOptionalModels(github.files)).resolves.toEqual([failing]);
  quiet.mockRestore();
  expect(hasAsset(github.files, optionalAssets()[1])).toBe(true);
});

test('a file kept under an older pin is not trusted: it is fetched again and the old copy is deleted', async () => {
  const github = fakeGitHub();
  const model = requiredAssets()[0];
  const olderPin = `${'0'.repeat(16)}-${model.name}`;
  github.stored.set(olderPin, '0'.repeat(64));
  github.stored.set(model.name, 'a file from before names carried the hash');
  expect(missingAssets(github.files)).toContain(model);
  await downloadModels(github.files);
  expect(github.requested.some((url) => url.endsWith(`/${model.name}`))).toBe(true);
  expect(github.stored.has(olderPin)).toBe(false);
  expect(github.stored.has(model.name)).toBe(false);
  expect(modelsReady(github.files)).toBe(true);
});

test('clearing stale files keeps every currently pinned file', async () => {
  const github = fakeGitHub();
  await downloadModels(github.files);
  await downloadOptionalModels(github.files);
  const before = [...github.stored.keys()].sort();
  github.stored.set('leftover.part', 'x');
  removeStaleFiles(github.files);
  expect([...github.stored.keys()].sort()).toEqual(before);
  expect(before).toHaveLength(everyAsset().length);
});

test('the download size is stated in megabytes', () => {
  expect(downloadSizeText([{ name: 'a', bytes: 88_999_043, release: 'v', sha256: '' }])).toBe('about 89 MB');
  expect(downloadSizeText([{ name: 'a', bytes: 1200, release: 'v', sha256: '' }])).toBe('under 1 MB');
});

test('the connection test asks each GitHub source and reports what answered', async () => {
  const asked: string[] = [];
  const fetchMock = (async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method} ${url}`);
    if (url.includes('card-scanner-data') && url.includes('prices')) return { ok: false, status: 404 } as Response;
    if (url.includes('manifest')) throw new Error('Network request failed');
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
  const result = await checkDataSources(fetchMock);
  expect(asked).toHaveLength(3);
  expect(asked.every((line) => line.startsWith('HEAD https://github.com/fabcrowd/'))).toBe(true);
  expect(result.map((source) => source.ok)).toEqual([true, false, false]);
  expect(result[1].detail).toBe('Answered 404');
  expect(result[2].detail).toBe('Network request failed');
});
