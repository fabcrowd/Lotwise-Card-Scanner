// What the Review screen does to a card: pick, retry the price, go back to the choices, save.

import { acceptPrice, priceRow } from '../core/pricing';
import { confirmPick } from '../core/recognize';
import type { CatalogCard, ScanRow } from '../core/types';
import { keepCrop, library } from '../device/files';
import { changeReviewRow, reviewCards, updateReviewCard, type ReviewCard } from '../state/session';

/** Fetches the price for a confirmed row; a late answer never overwrites a newer pick or a withdrawn one. */
async function priceAndApply(id: string, confirmed: ScanRow): Promise<void> {
  let priced: ScanRow;
  try {
    priced = await priceRow(confirmed);
  } catch (err) {
    console.error('[review] price failed:', err instanceof Error ? err.message : err);
    priced = { ...confirmed, pricing: false, priceError: true };
  }
  changeReviewRow(id, (current) => acceptPrice(current, priced));
}

export async function pickCard(card: ReviewCard, chosen: CatalogCard): Promise<void> {
  const confirmed = confirmPick(card.row, chosen);
  updateReviewCard(card.id, { row: confirmed, printing: null });
  await priceAndApply(card.id, confirmed);
}

export async function retryPrice(card: ReviewCard): Promise<void> {
  if (!card.row.identity?.id) return;
  const again: ScanRow = { ...card.row, pricing: true, priceError: false };
  updateReviewCard(card.id, { row: again });
  await priceAndApply(card.id, again);
}

export function changeCard(card: ReviewCard): void {
  updateReviewCard(card.id, {
    row: {
      ...card.row,
      userConfirmed: false,
      unsure: true,
      pricing: false,
      priceError: false,
      market_price: null,
      price_variant: null,
      price_grid: null,
    },
    printing: null,
  });
}

export const canSave = (card: ReviewCard): boolean => card.row.userConfirmed === true && !card.row.pricing && !card.savedKey;

const saving = new Set<string>();

/**
 * Moves the picture into the app's folder under the card's id, then adds the card to the library. A card is saved
 * once: a second request while the first is running, or after it finished, does nothing.
 */
export async function saveCard(card: ReviewCard): Promise<void> {
  const latest = reviewCards().find((entry) => entry.id === card.id);
  if (!latest || !canSave(latest) || saving.has(card.id)) return;
  saving.add(card.id);
  try {
    const kept = await keepCrop(latest.cropUri, latest.id);
    const saved = await library.add({ row: latest.row, printing: latest.printing, cropUri: kept });
    updateReviewCard(latest.id, { savedKey: saved.key });
  } finally {
    saving.delete(card.id);
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Try again.';
}
