import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stripDevBlocks } from '../scripts/lib/store-package.mjs';

const root = path.join('tools', 'extension-wasm');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('the look-alike setting is in the developer and the store options page, unchecked', () => {
  const html = read('options.html');
  for (const text of [html, stripDevBlocks(html, 'options.html')]) {
    assert.match(text, /<input type="checkbox" id="reduce-lookalikes"> Experimental: reduce look-alike matches/);
    assert.doesNotMatch(text, /id="reduce-lookalikes"[^>]*checked/);
  }
});

test('the setting is stored under one key, read as on only when exactly true, and applied in both scan paths', () => {
  const options = stripDevBlocks(read('options.js'), 'options.js');
  assert.match(options, /reduceLookalikes: lookalikeToggle\.checked/);
  assert.match(options, /lookalikeToggle\.checked = reduceLookalikes === true/);
  const background = stripDevBlocks(read('background.js'), 'background.js');
  assert.match(background, /\.reduceLookalikes === true/);
  // Both scan paths search through searchBoth, which hands the setting to searchPair (lib/search.js) for the normal and the raw search.
  assert.equal(background.match(/await searchBoth\(embedding\)/g).length, 2);
  assert.equal(background.match(/searchPair\(embedding, _meta, \{ penalty: await lookalikePenaltyInUse\(\) \}\)/g).length, 1);
  const search = read(path.join('lib', 'search.js'));
  assert.equal(search.match(/\{ penalty \}\)/g).length, 1);
  assert.equal(search.match(/\{ penalty, raw: true \}\)/g).length, 1);
  // The saved-example margin gets the true raw top, not the first (rank-ordered) hit's score.
  assert.equal(background.match(/await withReferenceHit\([^\n]*, rawTop/g).length, 2);
  assert.doesNotMatch(background, /withReferenceHit\([^\n]*rawHits\[0\]/);
  // The card-back check, the Japanese check and seen.catalogTop also read the true raw top, never rawHits[0].
  assert.doesNotMatch(read('background.js'), /rawHits\[0\]\?\.score/);
  assert.equal(background.match(/isCardBack\(embedding, rawTop\)/g).length, 2);
  assert.equal(background.match(/bestEn: rawTop/g).length, 2);
  assert.match(background, /seen\.catalogTop = rawHits\.length \? rawTop : null;/);
});

test('the penalty file is a local asset of the extension, never a download', () => {
  const setup = read(path.join('lib', 'setup.js'));
  assert.doesNotMatch(setup, /hub-penalty/);
  assert.match(read('background.js'), /data\/hub-penalty\.bin/);
});

test('three copies of one name in a photo are checked right after that photo is read', () => {
  const background = read('background.js');
  assert.match(background, /markRepeatedNames\(photoReads\)/);
});
