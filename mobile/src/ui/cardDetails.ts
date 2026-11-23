import { formatUsd } from '../core/ext';
import type { SavedCard } from '../core/types';
import { savedPrice } from '../data/library';
import { printingLabel } from './PrintingChoices';

/** One line for pasting: "Name · Set · Number · Printing · $price NM". */
export function detailsLine(card: SavedCard): string {
  const identity = card.row.identity;
  const price = savedPrice(card);
  return [
    identity?.name,
    identity?.set,
    identity?.number,
    card.printing ? printingLabel(card.printing) : null,
    price != null ? `${formatUsd(price)} NM` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
