import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bg = readFileSync(new URL('../tools/extension-wasm/background.js', import.meta.url), 'utf8');

// The scan reply maps every card to the reply shape: each branch (hidden, not-card, unsure, identified) carries the
// card's own page crop, so every popup row has a picture and the compare preview has something to compare.
test('every card in the scan reply carries its crop, identified cards included', () => {
  const start = bg.indexOf('const withCandidates = cards.map(');
  const end = bg.indexOf('function hiddenReadWithCandidates');
  assert.ok(start > 0 && end > start, 'withCandidates map found');
  const body = bg.slice(start, end);
  const branches = body.split(/\n\s*(?:\?|:)\s/).length;
  assert.ok(branches >= 4);
  assert.equal((body.match(/crop: encoded\[i\] \?\? null/g) || []).length, 4, 'all four branches attach crop');
  assert.doesNotMatch(body, /:\s*card\)\);/, 'no branch passes a card through without its crop');
});
