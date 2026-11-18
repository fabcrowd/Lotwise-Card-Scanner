import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { stampFromCorner, stampSetCode } from '../tools/extension-wasm/lib/variant.js';
import { NO_REVERSE_PRICE, applySetStamp, stampFinishNote, stampedPrices } from '../tools/extension-wasm/lib/set-stamp.js';
import { PRICE_ERROR_TEXT } from '../tools/extension-wasm/lib/batch-price.js';
import { detectedVariant, isIdentified, lotEstimate, quotedPrice, suggestedVariant } from '../tools/extension-wasm/lib/card-display.js';
import { bestMatchPrice, priceTypicalOf } from '../tools/extension-wasm/lib/stakes.js';

// EX set-logo stamps (owner decision 2026-10-25: automatic). In ex10-ex16 only the reverse holos carry the expansion
// logo in the art corner, so a read logo settles the set and the Reverse Holofoil price, when both exist.

test('Legend Maker and Dragon Frontiers logos name their sets; DRAGON alone names none', () => {
  for (const text of ['LEGEND MAKER', 'LEGEND', 'MAKER', 'EX LEGEND MAKER']) {
    assert.equal(stampFromCorner(text), 'setstamp', text);
    assert.equal(stampSetCode(text), 'ex12', text);
  }
  for (const text of ['DRAGON FRONTIERS', 'FRONTIERS', 'FRONTIER', 'DRAGON FRONTIFRS']) {
    assert.equal(stampFromCorner(text), 'setstamp', text);
    assert.equal(stampSetCode(text), 'ex15', text);
  }
  // Dragon (ex3) is another set's name and appears in card text.
  assert.equal(stampSetCode('DRAGON'), null);
  assert.equal(stampFromCorner('DRAGON'), null);
  assert.equal(stampSetCode('Illus. Ken Sugimori'), null);
  // The sets already read are unchanged.
  assert.equal(stampSetCode('UNSEEN FORCES'), 'ex10');
  assert.equal(stampSetCode('POWER KEEPERS'), 'ex16');
});

const grid = (variants) => ({ source: 'tcgdex', variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { market: v, conditions: { NM: v } }])) });
const AERO_LM = { id: 'ex12-1', name: 'Aerodactyl', set: 'Legend Maker', setCode: 'ex12', number: '1' };
const AERO_SS = { id: 'ex7-1', name: 'Aerodactyl', set: 'Team Rocket Returns', setCode: 'ex7', number: '1' };
const catalog = [AERO_LM, AERO_SS, { id: 'ex15-3', name: 'Flygon', set: 'Dragon Frontiers', setCode: 'ex15', number: '3' }];

function deps(prices) {
  const priced = [];
  return {
    priced,
    cardsInSet: (setCode) => catalog.filter((c) => c.setCode === setCode),
    catalogCard: (id) => catalog.find((c) => c.id === id),
    priceIdentity: async (card) => { priced.push(card.id); return { price_grid: prices[card.id] ?? null, market_price: null }; },
  };
}

const stamped = (extra) => ({ abstain: false, confidence: 0.9, variant: { edition: null, finish: null, stamp: 'setstamp' }, ...extra });

test('an ex12 stamp with a Reverse Holofoil price: set, finish and price are settled with no pick', async () => {
  const d = deps({ 'ex12-1': grid({ holofoil: 75.2, reverseHolofoil: 125 }) });
  // The set was open between two printings of the name.
  const open = stamped({
    identity: null, abstain: true,
    setChoices: [{ id: 'ex12-1', setCode: 'ex12', name: 'Aerodactyl' }, { id: 'ex7-1', setCode: 'ex7', name: 'Aerodactyl' }],
  });
  const card = await applySetStamp(open, 'LEGEND MAKER', d);
  assert.equal(card.identity.id, 'ex12-1');
  assert.equal(card.setChoices, undefined);
  assert.equal(card.setEvidence, 'stamp');
  assert.equal(card.finishSure, 'reverse');
  assert.equal(detectedVariant(card), 'reverseHolofoil');
  assert.equal(isIdentified(card), true);
  assert.equal(quotedPrice(card, detectedVariant(card)).price, 125);
  assert.equal(stampFinishNote(card), null);

  // The name was read in another set: the logo moves it.
  const elsewhere = await applySetStamp(stamped({ identity: AERO_SS, price_grid: grid({ holofoil: 9 }) }), 'MAKER', deps({ 'ex12-1': grid({ holofoil: 75.2, reverseHolofoil: 125 }) }));
  assert.equal(elsewhere.identity.id, 'ex12-1');
  assert.equal(detectedVariant(elsewhere), 'reverseHolofoil');
  assert.equal(quotedPrice(elsewhere, detectedVariant(elsewhere)).price, 125);
});

test('a failed price lookup keeps the stamped card, without a price', async () => {
  const d = { ...deps({}), priceIdentity: async () => { throw new Error('every price source failed'); } };
  const card = await applySetStamp(stamped({ identity: AERO_SS }), 'LEGEND MAKER', d);
  assert.equal(card.identity.id, 'ex12-1');
  assert.equal(card.setEvidence, 'stamp');
  assert.equal(card.market_price ?? null, null);
  assert.equal(quotedPrice(card, undefined), null);
});

test('a failed price lookup marks the card like a failed batch price, and shows no "price not available" note', async () => {
  const d = { ...deps({}), priceIdentity: async () => { throw new Error('every price source failed'); } };
  const card = await applySetStamp(stamped({ identity: AERO_SS }), 'LEGEND MAKER', d);
  assert.equal(card.priceError, PRICE_ERROR_TEXT);
  assert.equal(stampFinishNote(card), null);
  // A real missing reverse price (the lookup worked) still gets the note, and carries no failure mark.
  const real = await applySetStamp(stamped({ identity: AERO_SS }), 'LEGEND MAKER', deps({ 'ex12-1': grid({ normal: 3, holofoil: 75.2 }) }));
  assert.equal(real.priceError, undefined);
  assert.equal(stampFinishNote(real), NO_REVERSE_PRICE);
});

test('an ex12 stamp without a Reverse Holofoil price: the set is chosen, the finish is left to the user with a note', async () => {
  const d = deps({ 'ex12-1': grid({ normal: 3, holofoil: 75.2 }) });
  const card = await applySetStamp(stamped({ identity: AERO_SS }), 'LEGEND MAKER', d);
  assert.equal(card.identity.id, 'ex12-1');
  assert.equal(card.setChoices, undefined);
  assert.equal(card.finishSure, undefined);
  assert.equal(detectedVariant(card), null);
  assert.equal(suggestedVariant(card), null);
  assert.equal(quotedPrice(card, undefined), null, 'not priced until the user picks a finish');
  assert.equal(stampFinishNote(card), NO_REVERSE_PRICE);
  assert.equal(NO_REVERSE_PRICE, 'Reverse holo price not available');
});

test('a stamp whose set does not have the card, or that is not a set logo, leaves the read as it was', async () => {
  const before = stamped({ identity: { id: 'ex7-50', name: 'Pikachu', setCode: 'ex7', number: '50' }, price_grid: grid({ normal: 1 }) });
  const d = deps({});
  const snapshot = JSON.stringify(before);
  assert.equal(JSON.stringify(await applySetStamp(before, 'LEGEND MAKER', d)), snapshot, 'name not in Legend Maker');
  assert.deepEqual(d.priced, []);
  const open = stamped({ identity: null, setChoices: [{ id: 'ex7-1', setCode: 'ex7' }, { id: 'ex9-1', setCode: 'ex9' }] });
  const openSnapshot = JSON.stringify(open);
  assert.equal(JSON.stringify(await applySetStamp(open, 'LEGEND MAKER', d)), openSnapshot, 'no choice in the stamp set');
  const aero = stamped({ identity: AERO_SS });
  assert.equal(JSON.stringify(await applySetStamp(aero, 'PLATINUM', d)), JSON.stringify(stamped({ identity: AERO_SS })), 'PLATINUM names no set');
  assert.equal(JSON.stringify(await applySetStamp(aero, 'DRAGON', d)), JSON.stringify(stamped({ identity: AERO_SS })), 'DRAGON alone');
  const cleared = { identity: AERO_SS, variant: { edition: null, finish: null, stamp: 'none' } };
  assert.equal(JSON.stringify(await applySetStamp(cleared, 'LEGEND MAKER', d)), JSON.stringify({ identity: AERO_SS, variant: { edition: null, finish: null, stamp: 'none' } }), 'stamp cleared (Wizards copyright)');
  // A set read from the printed number is not overruled by a logo read.
  const numbered = stamped({ identity: AERO_SS, setEvidence: 'number' });
  assert.equal((await applySetStamp(numbered, 'LEGEND MAKER', d)).identity.id, 'ex7-1');
  assert.deepEqual(d.priced, []);
});

// Director decision 2026-10-25: a stamped card IS a reverse holo; with no Reverse Holofoil price it has no price at
// all, never another printing's, even when the grid has a single printing.
test('a stamped card with no Reverse Holofoil price is never priced as another printing, even a single one', async () => {
  for (const variants of [{ holofoil: 75.2 }, { normal: 3, holofoil: 75.2 }]) {
    const card = await applySetStamp(stamped({ identity: AERO_SS }), 'LEGEND MAKER', deps({ 'ex12-1': grid(variants) }));
    const label = Object.keys(variants).join('+');
    assert.equal(card.identity.id, 'ex12-1', label);
    assert.equal(card.stampSet, 'ex12', label);
    assert.equal(quotedPrice(card, detectedVariant(card)), null, label);
    for (const key of Object.keys(variants)) assert.equal(quotedPrice(card, key), null, `${label}: a pick of ${key}`);
    assert.equal(priceTypicalOf(card, null), null, label);
    assert.equal(card.market_price, null, label);
    const lot = lotEstimate([card], () => undefined);
    assert.equal(lot.low + lot.high, 0, label);
    assert.equal(lot.noPrice, 1, label);
    assert.equal(stampFinishNote(card), NO_REVERSE_PRICE, label);
  }
});

test('a price answer for a stamped card keeps only its reverse price; another set\'s card is priced as usual', () => {
  const card = { identity: AERO_LM, stampSet: 'ex12', setEvidence: 'stamp', variant: { stamp: 'setstamp', finish: 'reverse' } };
  const holoOnly = { price_grid: grid({ holofoil: 75.2 }), market_price: 75.2, price_variant: 'holofoil' };
  const kept = stampedPrices(card, holoOnly);
  assert.deepEqual(Object.keys(kept.price_grid.variants), []);
  assert.equal(kept.market_price, null);
  assert.equal(kept.price_variant, null);
  const withReverse = { price_grid: grid({ holofoil: 75.2, reverseHolofoil: 125 }), market_price: 75.2, price_variant: 'holofoil' };
  assert.equal(stampedPrices(card, withReverse), withReverse);
  // The user picked the card in another set: the stamp no longer applies.
  assert.equal(stampedPrices({ ...card, identity: AERO_SS }, holoOnly), holoOnly);
  assert.equal(stampedPrices({ identity: AERO_LM }, holoOnly), holoOnly, 'no stamp read');
  // A Choose row's best match is not priced from another printing either.
  const choose = { ...card, identity: null, abstain: true };
  assert.equal(bestMatchPrice(choose, { identity: AERO_LM, ...holoOnly }).price, null);
  assert.equal(bestMatchPrice(choose, { identity: AERO_LM, ...withReverse }).price, 125);
  assert.equal(bestMatchPrice(choose, { identity: AERO_SS, ...holoOnly }).price, 75.2);
});

// D14 (gate 2, S2 Pinsir δ 9/101 Dragon Frontiers): the picture reads "Pinsir", the catalog says "Pinsir δ".
// Director decision: in the delta-species sets ex11, ex13 and ex15 a read name equal to the catalog name without a
// trailing " δ" (or " delta") is the same name.
test('in a delta-species set, a name read without δ is the δ card of that set', async () => {
  const PINSIR_DF = { id: 'ex15-9', name: 'Pinsir δ', set: 'Dragon Frontiers', setCode: 'ex15', number: '9' };
  const FLYGON_DF = { id: 'ex15-3', name: 'Flygon δ', set: 'Dragon Frontiers', setCode: 'ex15', number: '3' };
  const PINSIR_LT = { id: 'sm8-4', name: 'Pinsir', set: 'Lost Thunder', setCode: 'sm8', number: '4' };
  const sets = {
    ex15: [FLYGON_DF, PINSIR_DF],
    ex13: [{ id: 'ex13-50', name: 'Pinsir delta', setCode: 'ex13', number: '50' }],
    ex11: [{ id: 'ex11-40', name: 'Pinsir ex δ', setCode: 'ex11', number: '40' }],
    ex12: [{ id: 'ex12-90', name: 'Pinsir δ', setCode: 'ex12', number: '90' }],
  };
  const deltaDeps = () => ({
    cardsInSet: (code) => sets[code] || [],
    catalogCard: () => undefined,
    priceIdentity: async () => ({ price_grid: grid({ holofoil: 25.27, reverseHolofoil: 48.98 }), market_price: null }),
  });
  // As on S2: named "Pinsir" with modern printings on offer, none of them Dragon Frontiers.
  const s2 = stamped({
    identity: PINSIR_LT,
    setChoices: [{ id: 'sm8-4', setCode: 'sm8' }, { id: 'sv8pt5-3', setCode: 'sv08.5' }, { id: 'swsh7-1', setCode: 'swsh7' }],
  });
  const card = await applySetStamp(s2, 'DRAGON FRONTIERS', deltaDeps());
  assert.equal(card.identity.id, 'ex15-9');
  assert.equal(card.finishSure, 'reverse');
  assert.equal(quotedPrice(card, detectedVariant(card)).price, 48.98);
  // The same rule for "delta" spelled out, and for a δ ex card, in the other delta sets.
  assert.equal((await applySetStamp(stamped({ identity: PINSIR_LT }), 'HOLON PHANTOMS', deltaDeps())).identity.id, 'ex13-50');
  assert.equal((await applySetStamp(stamped({ identity: { ...PINSIR_LT, name: 'Pinsir ex' } }), 'DELTA SPECIES', deltaDeps())).identity.id, 'ex11-40');
  // A name read with its δ still matches exactly.
  assert.equal((await applySetStamp(stamped({ identity: PINSIR_DF }), 'FRONTIERS', deltaDeps())).identity.id, 'ex15-9');
  // Outside ex11, ex13 and ex15 the names stay exact; and a different name never matches.
  const strict = stamped({ identity: PINSIR_LT });
  assert.equal((await applySetStamp(strict, 'LEGEND MAKER', deltaDeps())).identity.id, 'sm8-4');
  assert.equal((await applySetStamp(stamped({ identity: { ...PINSIR_LT, name: 'Pins' } }), 'FRONTIERS', deltaDeps())).identity.id, 'sm8-4');
});

test('the scanner settles stamps through applySetStamp and the popup shows the missing-price note', () => {
  const background = readFileSync(new URL('../tools/extension-wasm/background.js', import.meta.url), 'utf8');
  assert.match(background, /await applySetStamp\(result, artText, \{ cardsInSet: catalogCardsInSet, catalogCard, priceIdentity \}\)/);
  assert.doesNotMatch(background, /choiceForStamp\(result\.setChoices/);
  const popup = readFileSync(new URL('../tools/extension-wasm/popup.js', import.meta.url), 'utf8');
  assert.match(popup, /stampFinishNote\(card\)/);
  // A pick re-prices the row through the same rule, and the note shows even with no finish to choose.
  assert.match(popup, /\.\.\.stampedPrices\(\{ \.\.\.current, identity: resp\.identity \}, \{ market_price, price_variant, price_grid \}\)/);
  assert.match(popup, /if \(!chips\.length\) return stampOnly/);
});
