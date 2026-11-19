// Sends queued contributions to the relay in batches. Failures keep the batch and wait longer each time.

export const BATCH_SIZE = 20;
// Below the relay's 1 MiB body cap (MAX_BODY_BYTES in tools/relay/src/handler.js), which answers 413 above it.
export const BATCH_BYTE_BUDGET = 1_000_000;
// The relay refuses a `day` more than 2 days from its date, past or future (MAX_DAY_SKEW_MS in tools/relay/src/validate.js).
const MAX_DAY_SKEW_MS = 2 * 86400000;
const EMPTY_BODY_BYTES = new TextEncoder().encode(JSON.stringify({ v: 1, contributions: [] })).length;
const itemBytes = (item) => new TextEncoder().encode(JSON.stringify(item)).length;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 6 * 3600 * 1000;

/** How long to wait after the `failures`-th failure in a row. */
export function backoffDelay(failures) {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, failures - 1));
}

// The relay refuses a batch it will never accept; retrying would only repeat the refusal.
const retryable = (status) => status >= 500 || status === 429 || status === 408;

/**
 * @param backoff { get(): { failures, nextAt } | null, set(state), clear() } persisted, because the worker sleeps
 * @param fetchFn fetch-compatible
 */
export function createUploader({ store, relayUrl, fetchFn = (...args) => fetch(...args), backoff, now = Date.now }) {
  let running = null;

  async function drain() {
    if (!relayUrl) return { sent: 0, left: await store.count(), inert: true };
    let sent = 0;
    let dropped = 0;
    for (;;) {
      const waiting = await backoff.get();
      if (waiting && now() < waiting.nextAt) return { sent, left: await store.count(), waiting: true };
      const peeked = await store.peek(BATCH_SIZE);
      if (peeked.length === 0) return dropped ? { sent, left: 0, dropped } : { sent, left: 0 };
      // Items the relay can never accept would take the rest of their batch down with them.
      const today = Date.parse(`${new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`);
      const hopeless = peeked.filter((row) => Math.abs(Date.parse(`${row.item.day}T00:00:00Z`) - today) > MAX_DAY_SKEW_MS
        || EMPTY_BODY_BYTES + itemBytes(row.item) > BATCH_BYTE_BUDGET);
      if (hopeless.length > 0) {
        await store.remove(hopeless.map((row) => row.seq));
        dropped += hopeless.length;
        continue;
      }
      const batch = [];
      let bytes = EMPTY_BODY_BYTES;
      for (const row of peeked) {
        const size = itemBytes(row.item) + (batch.length > 0 ? 1 : 0);
        if (batch.length > 0 && bytes + size > BATCH_BYTE_BUDGET) break;
        batch.push(row);
        bytes += size;
      }
      let status = 0;
      try {
        const response = await fetchFn(relayUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify({ v: 1, contributions: batch.map((row) => row.item) }),
        });
        status = response.status;
        if (!response.ok && retryable(status)) status = -1;
        else if (response.ok) status = 0;
      } catch {
        status = -1;
      }
      if (status === -1) {
        const failures = ((await backoff.get())?.failures ?? 0) + 1;
        await backoff.set({ failures, nextAt: now() + backoffDelay(failures) });
        return { sent, left: await store.count(), waiting: true };
      }
      await store.remove(batch.map((row) => row.seq));
      await backoff.clear();
      if (status === 0) sent += batch.length;
      else dropped += batch.length;
    }
  }

  return {
    /** One drain at a time: a second request while one runs shares its result. */
    flush() {
      running ??= drain().finally(() => { running = null; });
      return running;
    },
  };
}
