// Saving a correction against the corrections store: history and the x2 count, the cap, and a full disk.
// The store is passed in (lib/corrections-store.js), so the same code runs under test with a fake IndexedDB.

import { MAX_CORRECTIONS, nextCorrectionState, pickEvictions } from "./correction-state.js";
import { isJaId } from "./japanese.js";

const isQuotaError = (err) => err?.name === "QuotaExceededError" || /quota/i.test(String(err?.message || ""));

/**
 * The user confirmed the card an earlier correction (msg.guess.memory.refId) pointed at, from another crop: that is
 * "x2" on the earlier correction instead of a near-duplicate picture. Null when this is not that case.
 * @returns {Promise<{count: number}|null>}
 */
export async function agreeWithReference(store, msg, now = Date.now()) {
  const ref = msg.guess?.memory;
  if (!ref?.refId || ref.cardId !== msg.pickedId || ref.refId === `${msg.scanId}:${msg.index}`) return null;
  const row = await store.getCorrection(ref.refId).catch(() => null);
  if (!row || row.pickedId !== msg.pickedId) return null;
  const count = (row.count || 1) + 1;
  await store.save({ ...row, count, lastAgreed: now });
  return { count };
}

/**
 * An exam-split photo's pick is queued for the shared exam only when sharing is on (the exam set must never train);
 * with sharing off nothing is queued for anyone. This never decides whether the correction is kept on this device:
 * every correction is stored locally. @returns {Promise<boolean>} whether the pick was queued
 */
export async function holdExamPick(store, scan, msg, sharingEnabled) {
  if (!sharingEnabled || scan?.shares?.[msg.index]?.split !== "exam") return false;
  const source = msg.via === "wrong-card" ? "wrong-card" : "pick";
  await store.saveScan({ ...scan, examPicks: { ...scan.examPicks, [msg.index]: { cardId: msg.pickedId, source } } });
  return true;
}

/**
 * A Japanese pick on an exam-split photo replaces whatever English answer was held for that box, so the stale one is not
 * uploaded later. @returns {Promise<boolean>} whether a held answer was removed
 */
export async function clearExamPick(store, scan, msg) {
  if (!scan?.examPicks || !(msg.index in scan.examPicks)) return false;
  const rest = { ...scan.examPicks };
  delete rest[msg.index];
  await store.saveScan({ ...scan, examPicks: rest });
  return true;
}

/**
 * What a pick does to the exam answers held for its photo: a Japanese card or any pick on a Japanese row holds nothing and
 * clears an earlier answer for that box; any other pick is held when `holdAllowed` and sharing is on (holdExamPick).
 * `sharingEnabled` is a function, asked only when it matters.
 */
export async function settleExamPick(store, scan, msg, { holdAllowed, sharingEnabled }) {
  if (keepsNoPicture(msg)) return clearExamPick(store, scan, msg);
  if (!holdAllowed) return false;
  return holdExamPick(store, scan, msg, await sharingEnabled());
}

/** A pick made on a row treated as Japanese, or of a Japanese card, keeps the answer but never a picture to compare against. */
export const keepsNoPicture = (msg) => msg?.guess?.japanese === true || isJaId(msg?.pickedId);

/** Corrections beyond `max` are deleted, the oldest unprotected first (lib/correction-state.js), with their references. */
export async function evictCorrections(store, max = MAX_CORRECTIONS, now = Date.now()) {
  const heads = await store.correctionHeads();
  const ids = pickEvictions(heads, { max, now });
  for (const id of ids) {
    await store.deleteReference(id);
    await store.deleteCorrection(id);
  }
  return ids;
}

// A full disk must not lose the answer: make room, retry, and as a last resort keep the answer without its picture.
async function saveRow(store, record, now) {
  try {
    await store.save(record);
    return;
  } catch (err) {
    if (!isQuotaError(err)) throw err;
  }
  const count = await store.count().catch(() => 0);
  await evictCorrections(store, Math.max(0, count - 10), now).catch(() => []);
  try {
    await store.save(record);
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    await store.save({ ...record, crop: null });
  }
}

/**
 * Stores a correction record (lib/card-picker.js correctionRecord). A later answer for the same crop replaces the
 * active one but keeps the earlier answers and their why-records; the vector of the old answer goes; the cap is held.
 * @returns {Promise<object>} the row as saved (count, history)
 */
export async function storeCorrection(store, draft, { max = MAX_CORRECTIONS, now = Date.now() } = {}) {
  const previous = draft.id ? await store.getCorrection(draft.id).catch(() => null) : null;
  // A Japanese pick is kept as the user's answer but without its picture: a reference vector for it could only add a
  // card the English catalog does not have to the memory comparison, so none is ever made (lib/references.js needs a crop).
  const record = { ...draft, ...nextCorrectionState(previous, draft), ...(isJaId(draft.pickedId) ? { crop: null } : {}) };
  // The old answer's vector must not outlive it; a failed delete is caught by the ts check in correctionsToEmbed.
  if (record.id) await store.deleteReference(record.id).catch((err) => console.error("[BG] dropping the old reference failed:", err?.message || err));
  await saveRow(store, record, now);
  await evictCorrections(store, max, now).catch((err) => console.error("[BG] evicting old corrections failed:", err?.message || err));
  return record;
}
