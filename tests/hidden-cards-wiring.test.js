import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (name) => readFileSync(new URL(`../tools/extension-wasm/${name}`, import.meta.url), 'utf8');

test('a rejected box is no longer dropped: the scan loop builds a hidden notCard entry from it', () => {
  const bg = src('background.js');
  assert.doesNotMatch(bg, /if \(!hero && !\(await boxLooksLikeCard\(cardCanvas\)\)\) continue;/);
  assert.match(bg, /notCardEntry\(/);
  assert.match(bg, /overlayCards\(cards\)/);
});

test('the popup wires Show it and keeps hidden cards out of the overlay', () => {
  const popup = src('popup.js');
  assert.match(popup, /data-show-hidden|showHidden/);
  assert.match(popup, /overlayCards\(/);
  assert.match(popup, /renderNotCardGroup\(/);
});

test('the packaged check is loaded at startup and chosen by pickCheck against packBuild()', () => {
  const bg = src('background.js');
  assert.match(bg, /pickCheck\(stored, _packagedCheck, packBuild\(\)\)/);
  assert.doesNotMatch(bg, /_photoCheck = stored\?\.check \?\? null/);
});
