// A small catalog for the tests: each card's embedding is one axis of the 512-dimension space, so a query's score
// against card i is simply the query's i-th value.

import { gzipSync } from 'fflate';

import { loadCatalog } from '../../src/core/ext';
import { GunzipStream } from '../../src/platform/install';
import type { CatalogCard } from '../../src/core/types';

export const DIM = 512;

/** Node has its own DecompressionStream, so the tests put the phone's stand-in in its place. */
export function usePhoneGunzip(): void {
  (globalThis as unknown as { DecompressionStream: unknown }).DecompressionStream = GunzipStream;
}

export async function loadAxisCatalog(count: number): Promise<void> {
  usePhoneGunzip();
  const base = new Float32Array(count * DIM);
  for (let i = 0; i < count; i++) base[i * DIM + i] = 1;
  await loadCatalog(gzipSync(new Uint8Array(base.buffer)));
}

/** A unit-length query whose score against card i is proportional to weights[i]. */
export function queryFor(weights: Record<number, number>): Float32Array {
  const query = new Float32Array(DIM);
  for (const [index, weight] of Object.entries(weights)) query[Number(index)] = weight;
  const length = Math.hypot(...query);
  return query.map((value) => value / length);
}

export const card = (id: string, name: string, setCode: string, number: string): CatalogCard => ({
  id, name, set: setCode.toUpperCase(), setCode, number, imageUrl: `https://images.example/${id}.png`,
});
