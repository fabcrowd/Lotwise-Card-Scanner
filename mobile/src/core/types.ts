// The shapes the extension's modules pass around, written down once for the app. A ScanRow is the same object the
// extension keeps per scanned card, so its display, pricing and export functions work on it unchanged.

export interface CatalogCard {
  id: string;
  name: string;
  set?: string;
  setCode?: string;
  number?: string;
  imageUrl?: string;
}

export interface Hit {
  index: number;
  score: number;
  rank?: number;
}

export interface SetChoice {
  id: string;
  name: string;
  set?: string;
  setCode?: string;
  number?: string;
  imageUrl?: string;
  score?: number;
}

export interface RankedId {
  id: string;
  rank: number;
  score: number;
}

export interface PriceVariant {
  conditions?: Record<string, number | null>;
  market?: number | null;
}

export interface PriceGrid {
  source?: string;
  variants: Record<string, PriceVariant>;
  updatedAt?: string | null;
  defaultVariant?: string | null;
}

export interface PriceFields {
  market_price: number | null;
  price_variant: string | null;
  price_grid: PriceGrid | null;
}

export interface ScanRow extends PriceFields {
  identity: (Partial<CatalogCard> & { name?: string }) | null;
  confidence: number;
  abstain: boolean;
  catalogTop?: number | null;
  unsure?: boolean;
  choose?: boolean;
  reason?: string;
  cardBack?: boolean;
  smallSource?: boolean;
  setChoices?: SetChoice[];
  setUnconfirmed?: boolean;
  setConfirmed?: boolean;
  userConfirmed?: boolean;
  nearest?: string[];
  ranked?: RankedId[];
  candidates?: CatalogCard[];
  titleConfirmed?: boolean;
  titleContradicts?: string;
  titleReranked?: boolean;
  titleChoices?: string[];
  numberRead?: string;
  ocrText?: string;
  pricing?: boolean;
  priceError?: boolean;
  skipped?: boolean;
  /** Mobile only: the picture alone met the extension's confirm rule. Shown as a hint; the user still confirms. */
  pictureConfirmed?: boolean;
}

export interface NumberRead {
  text?: string;
  number: string | null;
  total: number | null;
}

export type TitleVerdict =
  | { kind: 'agree'; titleName: string }
  | { kind: 'contradict'; titleName: string }
  | { kind: 'silent'; titleName: null };

/** Anything the extension's modules accept as a canvas or bitmap. */
export interface CanvasLike {
  readonly width: number;
  readonly height: number;
}

export type Box = [number, number, number, number];

export interface Detection {
  box: Box;
  score: number;
}

export interface ModelAsset {
  name: string;
  bytes?: number;
  release: string;
  sha256: string;
}

export interface CandidateView {
  id: string;
  name: string;
  set: string;
  number: string;
  printing: string | null;
  art: string | null;
  agrees: boolean;
  best: boolean;
  label: string;
}

export interface PriceQuote {
  price: number;
  condition?: string;
  printing: string | null;
}

/** One confirmed card kept in the library. */
export interface SavedCard {
  key: string;
  savedAt: number;
  row: ScanRow;
  printing: string | null;
  cropUri: string | null;
}
