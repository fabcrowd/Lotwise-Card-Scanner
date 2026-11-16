// The cards from the latest photo, between the Scan screen that found them and the Review screen that confirms
// them. Kept in memory only: an unconfirmed card is never saved.

import { useSyncExternalStore } from 'react';

import type { ScannedCard } from '../device/engine';
import type { ScanRow } from '../core/types';

export interface ReviewCard extends ScannedCard {
  /** The printing the user picked for the price (for example "holofoil"), or null while it is open. */
  printing: string | null;
  /** Set once the card is in the library. */
  savedKey: string | null;
}

let cards: readonly ReviewCard[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly ReviewCard[]): void {
  cards = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startReview(scanned: readonly ScannedCard[]): void {
  publish(scanned.map((card) => ({ ...card, printing: null, savedKey: null })));
}

export function updateReviewCard(id: string, changes: Partial<Pick<ReviewCard, 'row' | 'printing' | 'savedKey'>>): void {
  publish(cards.map((card) => (card.id === id ? { ...card, ...changes } : card)));
}

/** Applies `change` to the card's current row, so a price that arrives late never overwrites a newer pick. */
export function changeReviewRow(id: string, change: (row: ScanRow) => ScanRow): void {
  publish(cards.map((card) => (card.id === id ? { ...card, row: change(card.row) } : card)));
}

export function removeReviewCard(id: string): void {
  publish(cards.filter((card) => card.id !== id));
}

export const reviewCards = (): readonly ReviewCard[] => cards;

export function useReviewCards(): readonly ReviewCard[] {
  return useSyncExternalStore(subscribe, reviewCards, reviewCards);
}
