import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boxSignalSource, contributeSignal, examGroups, examRows, shareFor, signalRow, teachRow, wantsExamPrompt, withBoxKind } from '../tools/extension-wasm/lib/share-rows.js';
import { splitOf } from '../tools/extension-wasm/lib/photo-id.js';

const scanner = (cardId = 'a') => ({ cardId, confidence: 0.5, stripe: 'medium' });
const share = (photoId, index, cardId) => ({ photoId, split: splitOf(photoId), box: [0, 0, 0.5, 0.5], scanner: scanner(cardId ?? `s${index}`) });
const EXAM = '0000000000000005';
const TEACH = '0000000000000001';

test('shareFor ties a card to its photo with the split and a normalized box', () => {
  const made = shareFor({ photoId: EXAM, box: [10, 10, 60, 110], width: 100, height: 200, card: { identity: { id: 'x' }, confidence: 0.9 } });
  assert.deepEqual(made, { photoId: EXAM, split: 'exam', box: [0.1, 0.05, 0.5, 0.5], scanner: { cardId: 'x', confidence: 0.9, stripe: 'high' }, detector: { score: null, aspect: 0.5, kind: 'found' } });
  assert.equal(shareFor({ photoId: TEACH, box: [5, 5, 5, 5], width: 100, height: 100, card: {} }), null);
});

test('shareFor carries the detector: the card score, the kind, and none when the aspect is out of range', () => {
  const box = [0, 0, 100, 140];
  assert.deepEqual(shareFor({ photoId: TEACH, box, width: 200, height: 200, card: { score: 0.8 } }).detector, { score: 0.8, aspect: 0.714, kind: 'found' });
  assert.equal(shareFor({ photoId: TEACH, box, width: 200, height: 200, card: {}, kind: 'missed' }).detector.kind, 'missed');
  const sliver = shareFor({ photoId: TEACH, box: [0, 0, 1, 40], width: 200, height: 200, card: {} });
  assert.ok(sliver);
  assert.ok(!('detector' in sliver));
});

test('teach and exam rows never carry the detector, even when the share has one', () => {
  const withDetector = { ...share(TEACH, 0), detector: { score: 0.5, aspect: 1, kind: 'found' } };
  assert.ok(!('detector' in teachRow({ share: withDetector, crop: 'QUJD', pickedId: 'x', via: 'search' })));
  const exam = { ...share(EXAM, 0), detector: { score: 0.5, aspect: 1, kind: 'found' } };
  const rows = examRows({ shares: [exam], indices: [0], crops: ['QUJD'], picks: {}, displayed: {}, known: () => true });
  assert.ok(!('detector' in rows[0]));
});

test('withBoxKind replaces the kind without touching the share', () => {
  const original = { ...share(TEACH, 0), detector: { score: 0.5, aspect: 1, kind: 'found' } };
  const next = withBoxKind(original, 'hidden');
  assert.deepEqual(next.detector, { score: 0.5, aspect: 1, kind: 'hidden' });
  assert.equal(original.detector.kind, 'found');
  assert.notEqual(next, original);
  assert.equal(withBoxKind(original, 'lost'), original);
  const bare = share(TEACH, 0);
  assert.equal(withBoxKind(bare, 'hidden'), bare);
  assert.equal(withBoxKind(null, 'hidden'), null);
});

test('signalRow builds a box signal row, answering a card id only for a drawn box with a pick', () => {
  const s = { ...share(TEACH, 0), detector: { score: null, aspect: 0.7, kind: 'missed' } };
  assert.deepEqual(signalRow({ share: s, crop: 'QUJD', source: 'removed' }), { box: s.box, crop: 'QUJD', answer: { unknown: true }, scanner: s.scanner, source: 'removed', detector: s.detector });
  assert.deepEqual(signalRow({ share: s, crop: 'QUJD', source: 'drawn', pickedId: 'base1-4' }).answer, { cardId: 'base1-4' });
  assert.deepEqual(signalRow({ share: s, crop: 'QUJD', source: 'drawn' }).answer, { unknown: true });
  assert.deepEqual(signalRow({ share: s, crop: 'QUJD', source: 'drawn', pickedId: '' }).answer, { unknown: true });
  assert.deepEqual(signalRow({ share: s, crop: 'QUJD', source: 'put-back', pickedId: 'base1-4' }).answer, { unknown: true });
});

test('signalRow is null without a detector, a crop or a signal source', () => {
  const s = { ...share(TEACH, 0), detector: { score: null, aspect: 0.7, kind: 'found' } };
  assert.equal(signalRow({ share: share(TEACH, 0), crop: 'QUJD', source: 'removed' }), null);
  assert.equal(signalRow({ share: s, crop: '', source: 'removed' }), null);
  assert.equal(signalRow({ share: s, crop: null, source: 'removed' }), null);
  assert.equal(signalRow({ share: s, crop: 'QUJD', source: 'pick' }), null);
  assert.equal(signalRow({ share: null, crop: 'QUJD', source: 'removed' }), null);
});

test('a pick or a Wrong card? fix becomes one row', () => {
  const row = teachRow({ share: share(TEACH, 0), crop: 'QUJD', pickedId: 'base1-4', via: 'wrong-card' });
  assert.deepEqual(row, { box: [0, 0, 0.5, 0.5], crop: 'QUJD', answer: { cardId: 'base1-4' }, scanner: scanner('s0'), source: 'wrong-card' });
  assert.equal(teachRow({ share: share(TEACH, 0), crop: 'QUJD', pickedId: 'x', via: 'candidates' }).source, 'pick');
  assert.equal(teachRow({ share: share(TEACH, 0), crop: 'QUJD', pickedId: 'x', via: 'search' }).source, 'pick');
});

test('exam rows are grouped by photo and teach rows are left out', () => {
  const shares = [share(EXAM, 0), share(TEACH, 1), share(EXAM, 2), null, share('00000000000000a0', 4)];
  const groups = examGroups(shares);
  assert.deepEqual([...groups.entries()], [[EXAM, [0, 2]], ['00000000000000a0', [4]]]);
  assert.equal(wantsExamPrompt(shares), true);
  assert.equal(wantsExamPrompt([share(TEACH, 0), null]), false);
  assert.equal(wantsExamPrompt([]), false);
});

test('confirming an exam photo answers every row: fixes first, then what the popup showed', () => {
  const shares = [share(EXAM, 0), share(EXAM, 1), share(EXAM, 2), share(EXAM, 3)];
  const rows = examRows({
    shares,
    indices: [0, 1, 2, 3],
    crops: ['c0', 'c1', 'c2', 'c3'],
    picks: { 1: { cardId: 'fixed', source: 'wrong-card' }, 3: { cardId: 'chosen', source: 'pick' } },
    displayed: { 0: { cardId: 'seen' }, 1: { cardId: 'ignored-because-fixed' }, 2: { notACard: true }, 3: { unknown: true } },
    known: (id) => id !== 'bad',
  });
  assert.deepEqual(rows.map((r) => [r.answer, r.source]), [
    [{ cardId: 'seen' }, 'confirm'],
    [{ cardId: 'fixed' }, 'wrong-card'],
    [{ notACard: true }, 'confirm'],
    [{ cardId: 'chosen' }, 'pick'],
  ]);
  assert.deepEqual(rows.map((r) => r.crop), ['c0', 'c1', 'c2', 'c3']);
  assert.deepEqual(rows[0].scanner, scanner('s0'));
});

test('a row nothing is known about, or whose id is not in the catalog, is answered unknown', () => {
  const rows = examRows({
    shares: [share(EXAM, 0), share(EXAM, 1)],
    indices: [0, 1],
    crops: ['c0', 'c1'],
    picks: {},
    displayed: { 0: { cardId: 'bad' } },
    known: (id) => id !== 'bad',
  });
  assert.deepEqual(rows.map((r) => r.answer), [{ unknown: true }, { unknown: true }]);
});

test('a photo with a row that has no picture cannot be sent as a whole, so none of it is', () => {
  assert.equal(examRows({ shares: [share(EXAM, 0), share(EXAM, 1)], indices: [0, 1], crops: ['c0', null], picks: {}, displayed: {}, known: () => true }), null);
});

const SIGNAL_OLD_CROP = 'data:image/jpeg;base64,OLD';
const SIGNAL_DRAWN_CROP = 'data:image/jpeg;base64,DRAWN';
const signalShare = (over = {}) => ({ photoId: 'p1', split: 'teach', box: [0, 0, 1, 1], scanner: {}, detector: { score: 0.5, aspect: 1, kind: 'found' }, ...over });

test('boxSignalSource: a scanned row gives its scan share and crop', () => {
  const found = signalShare();
  const scan = { crops: [SIGNAL_OLD_CROP], shares: [found] };
  assert.deepEqual(boxSignalSource(scan, { index: 0, source: 'removed' }), { share: found, crop: SIGNAL_OLD_CROP });
});

test('boxSignalSource: a drawn row gives the share and crop it brought', () => {
  const own = signalShare({ detector: { score: null, aspect: 0.7, kind: 'missed' } });
  const scan = { crops: [SIGNAL_OLD_CROP], shares: [signalShare({ photoId: 'other' })] };
  assert.deepEqual(boxSignalSource(scan, { index: 0, drawn: true, crop: SIGNAL_DRAWN_CROP, share: own, source: 'drawn' }), { share: own, crop: SIGNAL_DRAWN_CROP });
});

test('boxSignalSource is null for an exam share, a missing crop or share or detector, or a non-signal source', () => {
  const ok = signalShare();
  assert.equal(boxSignalSource({ crops: [SIGNAL_OLD_CROP], shares: [signalShare({ split: 'exam' })] }, { index: 0, source: 'removed' }), null);
  assert.equal(boxSignalSource({ crops: [''], shares: [ok] }, { index: 0, source: 'removed' }), null);
  assert.equal(boxSignalSource({ crops: [], shares: [ok] }, { index: 0, source: 'removed' }), null);
  assert.equal(boxSignalSource({ crops: [SIGNAL_OLD_CROP], shares: [] }, { index: 0, source: 'removed' }), null);
  assert.equal(boxSignalSource({ crops: [SIGNAL_OLD_CROP], shares: [signalShare({ detector: undefined })] }, { index: 0, source: 'removed' }), null);
  assert.equal(boxSignalSource({ crops: [SIGNAL_OLD_CROP], shares: [ok] }, { index: 0, source: 'pick' }), null);
  assert.equal(boxSignalSource({ crops: [SIGNAL_OLD_CROP], shares: [ok] }, { index: 0 }), null);
  assert.equal(boxSignalSource({ crops: [SIGNAL_OLD_CROP], shares: [ok] }, { index: 0, drawn: true, source: 'drawn', share: ok }), null);
  assert.equal(boxSignalSource(null, { index: 0, source: 'removed' }), null);
});

const stubSharing = ({ on = true } = {}) => {
  const calls = { enabled: 0, contribute: [] };
  return { calls, enabled: async () => { calls.enabled += 1; return on; }, contribute: async (payload) => { calls.contribute.push(payload); return { sent: true }; } };
};
const stubScan = (scan) => { const state = { looked: 0 }; return { state, get: async () => { state.looked += 1; return scan; } }; };
const stubShrink = (result = 'SHRUNK') => { const state = { crops: [] }; return { state, fn: async (crop) => { state.crops.push(crop); return result; } }; };

test('contributeSignal sends nothing, and never looks up the scan or shrinks a crop, while sharing is off', async () => {
  const sharing = stubSharing({ on: false });
  const scan = stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare()] });
  const shrink = stubShrink();
  assert.equal(await contributeSignal({ sharing, scan: scan.get, msg: { index: 0, source: 'removed' }, shrink: shrink.fn }), false);
  assert.equal(scan.state.looked, 0);
  assert.deepEqual(shrink.state.crops, []);
  assert.deepEqual(sharing.calls.contribute, []);
});

test('contributeSignal sends one one-card contribution for a scanned teach row', async () => {
  const sharing = stubSharing();
  const scan = stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare()] });
  const shrink = stubShrink();
  const result = await contributeSignal({ sharing, scan: scan.get, msg: { index: 0, source: 'removed' }, shrink: shrink.fn });
  assert.deepEqual(result, { sent: true });
  assert.deepEqual(shrink.state.crops, [SIGNAL_OLD_CROP]);
  assert.equal(sharing.calls.contribute.length, 1);
  const [{ photoId, cards }] = sharing.calls.contribute;
  assert.equal(photoId, 'p1');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].source, 'removed');
  assert.equal(cards[0].crop, 'SHRUNK');
  assert.deepEqual(cards[0].detector, { score: 0.5, aspect: 1, kind: 'found' });
});

test('contributeSignal sends nothing for an exam-split share', async () => {
  const sharing = stubSharing();
  const scan = stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare({ split: 'exam' })] });
  assert.equal(await contributeSignal({ sharing, scan: scan.get, msg: { index: 0, source: 'removed' }, shrink: stubShrink().fn }), false);
  assert.deepEqual(sharing.calls.contribute, []);
});

test('contributeSignal sends nothing for a stale or missing scan', async () => {
  for (const stored of [null, undefined]) {
    const sharing = stubSharing();
    assert.equal(await contributeSignal({ sharing, scan: stubScan(stored).get, msg: { index: 0, source: 'removed' }, shrink: stubShrink().fn }), false);
    assert.deepEqual(sharing.calls.contribute, []);
  }
  const sharing = stubSharing();
  assert.equal(await contributeSignal({ sharing, scan: stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare()] }).get, msg: { index: 3, source: 'removed' }, shrink: stubShrink().fn }), false);
  assert.deepEqual(sharing.calls.contribute, []);
});

test('contributeSignal uses the share and crop a drawn message carries, not scan.shares[index]', async () => {
  const sharing = stubSharing();
  const own = signalShare({ photoId: 'own', detector: { score: null, aspect: 0.7, kind: 'missed' } });
  const scan = stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare({ photoId: 'other' })] });
  const shrink = stubShrink();
  await contributeSignal({ sharing, scan: scan.get, msg: { index: 0, drawn: true, crop: SIGNAL_DRAWN_CROP, share: own, source: 'drawn' }, shrink: shrink.fn });
  assert.deepEqual(shrink.state.crops, [SIGNAL_DRAWN_CROP]);
  assert.equal(sharing.calls.contribute[0].photoId, 'own');
  assert.equal(sharing.calls.contribute[0].cards[0].source, 'drawn');
  assert.equal(sharing.calls.contribute[0].cards[0].detector.kind, 'missed');
});

test('contributeSignal sends nothing when the crop cannot be shrunk', async () => {
  const sharing = stubSharing();
  const scan = stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare()] });
  assert.equal(await contributeSignal({ sharing, scan: scan.get, msg: { index: 0, source: 'removed' }, shrink: stubShrink(null).fn }), false);
  assert.deepEqual(sharing.calls.contribute, []);
});

test('contributeSignal sends nothing for a share with no detector', async () => {
  const sharing = stubSharing();
  const scan = stubScan({ crops: [SIGNAL_OLD_CROP], shares: [signalShare({ detector: undefined })] });
  assert.equal(await contributeSignal({ sharing, scan: scan.get, msg: { index: 0, source: 'removed' }, shrink: stubShrink().fn }), false);
  assert.deepEqual(sharing.calls.contribute, []);
});
