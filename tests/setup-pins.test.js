import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { ASSETS, CACHE_NAME, OPTIONAL_ASSETS, assetUrl } from '../tools/extension-wasm/lib/setup.js';

// Models are cached by address (lib/setup.js). A changed sha256 under the same address and CACHE_NAME would leave every
// install with the old file forever, so each file's pin is committed here and a change must come with a new address.
// This is a development-time check; nothing is re-hashed at run time.

const SNAPSHOT_URL = new URL('./fixtures/setup-pins.snapshot.json', import.meta.url);

const current = () => ({
  cacheName: CACHE_NAME,
  files: [...ASSETS, ...OPTIONAL_ASSETS].map((a) => ({ name: a.name, url: assetUrl(a.name), sha256: a.sha256 })),
});

const HOW_TO_UPDATE = 'For a legitimate change (a new file, a new address), update the snapshot with '
  + '`$env:UPDATE_SETUP_PINS=1; node --test tests/setup-pins.test.js` (PowerShell) or '
  + '`UPDATE_SETUP_PINS=1 node --test tests/setup-pins.test.js`, then commit tests/fixtures/setup-pins.snapshot.json.';

/** Problems between the committed snapshot and the current pins; each one says what to do. */
export function pinProblems(snapshot, now) {
  const problems = [];
  const before = new Map(snapshot.files.map((f) => [f.name, f]));
  const sameCache = snapshot.cacheName === now.cacheName;
  for (const file of now.files) {
    const old = before.get(file.name);
    if (!old) {
      problems.push(`${file.name} is new. ${HOW_TO_UPDATE}`);
    } else if (old.sha256 !== file.sha256 && old.url === file.url && sameCache) {
      problems.push(`${file.name}: the sha256 changed but its address and CACHE_NAME did not, so installs that cached the old file would keep it forever. `
        + 'Change the release tag in the address or bump CACHE_NAME.');
    } else if (old.sha256 !== file.sha256 || old.url !== file.url) {
      problems.push(`${file.name}: its pin or address changed. ${HOW_TO_UPDATE}`);
    }
    before.delete(file.name);
  }
  for (const name of before.keys()) problems.push(`${name} was removed. ${HOW_TO_UPDATE}`);
  if (!sameCache) problems.push(`CACHE_NAME changed from ${snapshot.cacheName} to ${now.cacheName}. ${HOW_TO_UPDATE}`);
  return problems;
}

const snap = (over = {}) => ({ cacheName: 'c1', files: [{ name: 'a.onnx', url: 'https://x/v1/a.onnx', sha256: 'aa' }], ...over });

test('a sha256 changed under the same address and CACHE_NAME is refused with the fix', () => {
  const problems = pinProblems(snap(), snap({ files: [{ name: 'a.onnx', url: 'https://x/v1/a.onnx', sha256: 'bb' }] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /change the release tag in the address or bump CACHE_NAME/i);
});

test('a new address, a new file, a removed file or a new CACHE_NAME asks for a snapshot update, not a different pin', () => {
  const moved = pinProblems(snap(), snap({ files: [{ name: 'a.onnx', url: 'https://x/v2/a.onnx', sha256: 'bb' }] }));
  assert.match(moved.join(' '), /UPDATE_SETUP_PINS/);
  assert.doesNotMatch(moved.join(' '), /bump CACHE_NAME/);
  assert.match(pinProblems(snap(), snap({ files: [...snap().files, { name: 'b', url: 'u', sha256: 'c' }] })).join(' '), /b is new/);
  assert.match(pinProblems(snap(), snap({ files: [] })).join(' '), /a\.onnx was removed/);
  assert.match(pinProblems(snap(), snap({ cacheName: 'c2' })).join(' '), /CACHE_NAME changed/);
  assert.deepEqual(pinProblems(snap(), snap()), []);
});

test('every model file pin in lib/setup.js matches the committed snapshot', () => {
  const now = current();
  if (process.env.UPDATE_SETUP_PINS) {
    const old = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'));
    const silent = pinProblems(old, now).filter((p) => /bump CACHE_NAME/.test(p));
    assert.deepEqual(silent, [], 'the snapshot is not updated over a pin that changed under the same address');
    writeFileSync(SNAPSHOT_URL, `${JSON.stringify(now, null, 2)}\n`);
    return;
  }
  assert.deepEqual(pinProblems(JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8')), now), []);
});
