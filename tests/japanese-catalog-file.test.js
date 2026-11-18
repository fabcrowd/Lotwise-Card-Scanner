import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gunzip, parseJaCatalog } from '../tools/extension-wasm/lib/japanese.js';
import { modelTags } from '../tools/extension-wasm/lib/contribution.js';
import { OPTIONAL_ASSETS } from '../tools/extension-wasm/lib/setup.js';

// The real file is built in the sibling data repository and uploaded to the release by the owner.
// JA_CATALOG_FILE overrides the default path.
export const REAL_CATALOG = process.env.JA_CATALOG_FILE || 'C:\\repos\\projects\\card-scanner-data\\data\\ja-catalog\\catalog-ja.bin.gz';
const skip = existsSync(REAL_CATALOG) ? false : `the real Japanese catalog is not on disk at ${REAL_CATALOG}`;

test('the real Japanese catalog matches the pinned hash', { skip }, () => {
  const pinned = OPTIONAL_ASSETS.find((a) => a.name === 'catalog-ja.bin.gz').sha256;
  assert.equal(createHash('sha256').update(readFileSync(REAL_CATALOG)).digest('hex'), pinned);
});

test('the real Japanese catalog parses for this recognizer and crop, with every set marked Japanese', { skip }, async () => {
  const { clip, crop } = modelTags();
  const ja = parseJaCatalog(await gunzip(readFileSync(REAL_CATALOG)), { query: clip, crop });
  assert.equal(ja.n, 25531);
  assert.equal(ja.cards.length, 25531);
  assert.ok(ja.cards.every((card) => card.set.endsWith('(Japanese)')));
  assert.ok(ja.cards.every((card) => card.id === `jp-${card.tcgPlayerId}`));
});
