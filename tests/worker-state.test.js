import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saveDrawState, loadDrawState, saveHeldScan, loadHeldScan, clearHeldScan, heldForStorage, HELD_CAP_BYTES,
  HELD_SCAN_MAX_AGE_MS, pickRestored, settleRestore,
} from "../tools/extension-wasm/lib/worker-state.js";

function fakeSession() {
  const data = {};
  return {
    data,
    get: async (key) => (key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {}),
    set: async (obj) => { Object.assign(data, JSON.parse(JSON.stringify(obj))); },
    remove: async (key) => { delete data[key]; },
  };
}

test("draw mode (tab and era) survives a worker restart", async () => {
  const session = fakeSession();
  await saveDrawState(session, { tabId: 7, eraId: "sv" });
  assert.deepEqual(await loadDrawState(session), { tabId: 7, eraId: "sv" });
  await saveDrawState(session, null);
  assert.equal(await loadDrawState(session), null);
});

test("a damaged or unavailable draw record reads as draw mode off", async () => {
  const session = fakeSession();
  session.data.drawState = { tabId: "x" };
  assert.equal(await loadDrawState(session), null);
  assert.equal(await loadDrawState({ get: async () => { throw new Error("no session"); } }), null);
});

const bigCrop = "data:image/jpeg;base64," + "A".repeat(50_000);
const scan = () => ({
  scanId: "abc", srcWidth: 10, srcHeight: 20, targetTabId: 3, tabUrl: "https://x.test/a",
  cards: [{ identity: { id: "p-1" }, crop: bigCrop }, { identity: { id: "p-2" }, crop: bigCrop, notCard: true }],
});

test("the held scan drops card crops and keeps what the view needs", async () => {
  const stripped = heldForStorage(scan());
  assert.equal(stripped.cards.length, 2);
  assert.ok(stripped.cards.every((c) => c.crop === null));
  assert.equal(stripped.cards[0].identity.id, "p-1");
  assert.equal(stripped.scanId, "abc");
});

test("a finished held scan survives a restart without the crops", async () => {
  const session = fakeSession();
  const finishedAt = Date.now() - 1000;
  await saveHeldScan(session, { data: scan(), url: "https://x.test/a", finishedAt });
  const back = await loadHeldScan(session);
  assert.equal(back.url, "https://x.test/a");
  assert.equal(back.finishedAt, finishedAt);
  assert.equal(back.data.cards[1].notCard, true);
  assert.equal(back.data.cards[0].crop, null);
  assert.ok(JSON.stringify(session.data).length < 5000);
});

test("a held scan too big to keep is not stored, and the old one is removed", async () => {
  const session = fakeSession();
  await saveHeldScan(session, { data: scan(), url: "u", finishedAt: Date.now() });
  const huge = { ...scan(), cards: [{ identity: { id: "x" }, note: "n".repeat(HELD_CAP_BYTES + 1) }] };
  await saveHeldScan(session, { data: huge, url: "u", finishedAt: Date.now() });
  assert.equal(await loadHeldScan(session), null);
});

test("clearHeldScan and a scan without data leave nothing behind", async () => {
  const session = fakeSession();
  await saveHeldScan(session, { data: scan(), url: "u", finishedAt: Date.now() });
  await clearHeldScan(session);
  assert.equal(await loadHeldScan(session), null);
  await saveHeldScan(session, { data: null, url: null, finishedAt: 1 });
  assert.equal(await loadHeldScan(session), null);
});

test("storage errors never throw", async () => {
  const broken = { get: async () => { throw new Error("x"); }, set: async () => { throw new Error("x"); }, remove: async () => { throw new Error("x"); } };
  await saveDrawState(broken, { tabId: 1, eraId: null });
  await saveHeldScan(broken, { data: scan(), url: "u", finishedAt: 1 });
  await clearHeldScan(broken);
  assert.equal(await loadHeldScan(broken), null);
});

const T0 = 1_000_000_000_000;

test("a held scan one second under the age limit is restored", async () => {
  const session = fakeSession();
  await saveHeldScan(session, { data: scan(), url: "u", finishedAt: T0 });
  const back = await loadHeldScan(session, () => T0 + HELD_SCAN_MAX_AGE_MS - 1000);
  assert.equal(back?.finishedAt, T0);
});

test("a held scan at the age limit is not restored and is removed from storage", async () => {
  const session = fakeSession();
  await saveHeldScan(session, { data: scan(), url: "u", finishedAt: T0 });
  assert.equal(await loadHeldScan(session, () => T0 + HELD_SCAN_MAX_AGE_MS), null);
  assert.equal("heldScan" in session.data, false);
});

test("a stored held scan with no usable time is not restored and is removed", async () => {
  for (const finishedAt of [undefined, null, "soon", NaN]) {
    const session = fakeSession();
    session.data.heldScan = { data: heldForStorage(scan()), url: "u", finishedAt };
    assert.equal(await loadHeldScan(session, () => T0), null);
    assert.equal("heldScan" in session.data, false);
  }
});

test("the restore keeps a stored value only for state nothing set since the worker started", () => {
  assert.equal(pickRestored(false, null, 7), 7, "untouched takes the stored value");
  assert.equal(pickRestored(true, null, 7), null, "set to null stays null");
  assert.equal(pickRestored(true, 9, 7), 9, "set to a value keeps it");
  assert.equal(pickRestored(false, null, null), null);
});

test("the restore always settles: a task that throws is logged in one line and resolves", async () => {
  const warnings = [];
  await settleRestore(async () => { throw new Error("session storage is gone"); }, (m) => warnings.push(m));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /session storage is gone/);
  const rejecting = { get: async () => { throw new Error("x"); }, set: async () => {}, remove: async () => {} };
  let draw = "unset";
  await settleRestore(async () => { draw = await loadDrawState(rejecting); }, (m) => warnings.push(m));
  assert.equal(draw, null);
});
