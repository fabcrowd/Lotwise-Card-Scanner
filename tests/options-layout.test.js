import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stripDevBlocks } from '../scripts/lib/store-package.mjs';

const root = path.join('tools', 'extension-wasm');
const html = readFileSync(path.join(root, 'options.html'), 'utf8');
const optionsJs = readFileSync(path.join(root, 'options.js'), 'utf8');
const variants = { developer: html, store: stripDevBlocks(html, 'options.html') };

const indexOfOrFail = (text, needle) => {
  const i = text.indexOf(needle);
  assert.notEqual(i, -1, `missing: ${needle}`);
  return i;
};

for (const [name, text] of Object.entries(variants)) {
  test(`${name} options page: Prices, Photos and Help improve Sweep come first, then a closed Advanced`, () => {
    const prices = indexOfOrFail(text, '<div class="section-title">Prices</div>');
    const photos = indexOfOrFail(text, '<div class="section-title">Photos</div>');
    const help = indexOfOrFail(text, '<div class="section-title">Help improve Sweep</div>');
    const advanced = indexOfOrFail(text, '<details class="advanced" id="advanced-settings">');
    assert.ok(prices < photos && photos < help && help < advanced);
    assert.match(text, /<details class="advanced" id="advanced-settings">\s*<summary>[^<]*Advanced/);
  });

  test(`${name} options page: each control sits in its group`, () => {
    const at = (id) => indexOfOrFail(text, `id="${id}"`);
    const prices = text.indexOf('>Prices</div>');
    const photos = text.indexOf('>Photos</div>');
    const help = text.indexOf('>Help improve Sweep</div>');
    const advanced = text.indexOf('id="advanced-settings"');
    for (const id of ['ppt-card', 'prices-card', 'price-condition']) assert.ok(at(id) > prices && at(id) < photos, id);
    assert.ok(at('site-access') > photos && at('site-access') < help);
    assert.ok(at('share-optin') > help && at('share-optin') < advanced);
    for (const id of ['use-references', 'straighten-cards', 'japanese-cards', 'reduce-lookalikes']) assert.ok(at(id) > advanced, id);
  });

  test(`${name} options page: the Japanese cards switch is a visible checkbox with its hint`, () => {
    assert.match(text, /<input type="checkbox" id="japanese-cards"> Recognize Japanese cards<\/label>/);
    assert.match(text, /Japanese cards are shown as a question with Japanese matches\. Prices come from TCGplayer\./);
    assert.doesNotMatch(text, /id="japanese-card"[^>]*hidden/);
  });

  test(`${name} options page: Corrections is renamed Remember my fixes`, () => {
    const visible = text.replace(/<!--[\s\S]*?-->/g, '');
    assert.match(visible, />Remember my fixes</);
    assert.doesNotMatch(visible, />\s*Corrections\b/);
  });

  test(`${name} options page: the look-alike switch is hidden but keeps its id`, () => {
    assert.match(text, /<div class="source-card" id="lookalike-card" hidden>/);
    assert.match(text, /id="reduce-lookalikes"/);
  });
}

for (const [name, text] of Object.entries(variants)) {
  test(`${name} options page: no visible text says correction`, () => {
    const visible = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ');
    assert.doesNotMatch(visible, /correction/i);
    assert.match(visible, /Use my saved fixes/);
  });
}

test('the status texts on the fixes card say fixes, not corrections', () => {
  const strings = [...optionsJs.matchAll(/(?:showCorrectionsStatus\(|\?\s*)\s*(["`])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
  assert.ok(strings.length > 0);
  for (const s of strings) assert.doesNotMatch(s.replace(/\$\{[^}]*\}/g, ''), /correction/i, s);
  assert.match(optionsJs, /Exported \$\{resp\.corrections\.length\} fixes\./);
});

test('the saved-fixes count no longer says Corrections', () => {
  assert.doesNotMatch(optionsJs, /`Corrections: \$\{resp\.count\} saved`/);
  assert.doesNotMatch(optionsJs, /"Corrections: unavailable"/);
});

test('the Japanese cards setting is stored as a boolean and is on unless it is false, in the page and in the background', () => {
  assert.match(optionsJs, /japaneseCards: japaneseToggle\.checked/);
  assert.match(optionsJs, /japaneseToggle\.checked = japaneseCards !== false/);
  const background = readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.match(background, /\.japaneseCards !== false/);
  // Read at each scan and search, not once per worker start, so a change applies without a restart.
  assert.match(background, /async function activeJapaneseCatalog\(\) \{\s*if \(!\(await japaneseCardsInUse\(\)\)\) return null;/);
});

test('the developer-only controls stay inside dev-only blocks', () => {
  const store = variants.store;
  for (const needle of ['advanced-backend', 'drawn-examples-card', 'test-photos-card', 'test-collection']) {
    assert.ok(html.includes(needle), needle);
    assert.ok(!store.includes(needle), `${needle} leaked into the store page`);
  }
});
