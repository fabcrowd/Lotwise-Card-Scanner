import type { PriceGrid, ScanRow } from '../../src/core/types';

/** The extension's lot CSV has this many columns (lib/lot-export.js LOT_COLUMNS). */
export const LOT_COLUMN_COUNT = 14;

export function grid(nearMint: Record<string, number>, updatedAt = '2026-11-14T06:00:00Z'): PriceGrid {
  return {
    source: 'tcgdex',
    updatedAt,
    variants: Object.fromEntries(Object.entries(nearMint).map(([printing, price]) => [printing, { conditions: { NM: price }, market: price }])),
  };
}

/** A row the user confirmed, priced at Near Mint per printing. */
export function pricedRow(id: string, name: string, nearMint: Record<string, number>): ScanRow {
  const [setCode, number] = id.split('-');
  return {
    identity: { id, name, set: setCode.toUpperCase(), setCode, number },
    confidence: 0.9,
    abstain: false,
    unsure: false,
    userConfirmed: true,
    setConfirmed: true,
    market_price: Object.values(nearMint)[0] ?? null,
    price_variant: Object.keys(nearMint)[0] ?? null,
    price_grid: grid(nearMint),
  };
}
