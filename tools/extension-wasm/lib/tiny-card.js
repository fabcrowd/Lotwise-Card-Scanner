// A detector box under these sizes is too small to read. It is still a card the user can see, so it is kept as an
// unread entry (never named, priced, totalled or exported) instead of being dropped silently.
export const MIN_READ_BOX_W = 40;
export const MIN_READ_BOX_H = 60;
export const TOO_SMALL_LABEL = 'Too small';
export const TOO_SMALL_ROW_TEXT = 'Too small to read. Open the full-size photo.';

/** box = [x1, y1, x2, y2] in photo pixels. */
export function isTooSmallBox(box) {
  const [x1, y1, x2, y2] = box;
  return (x2 - x1) < MIN_READ_BOX_W || (y2 - y1) < MIN_READ_BOX_H;
}

/**
 * The entry for a box too small to read. It is shaped like a card back (the scanner's "not a card to identify"
 * state) so it stays out of totals, export and the choose flow, and is marked `tooSmall` so the label says why.
 */
export function tooSmallCard({ box, score, readHeight, ...extra }) {
  return {
    box, score, ...extra,
    identity: null, confidence: 0, abstain: true, cardBack: true, tooSmall: true,
    market_price: null, price_variant: null, price_grid: null, readHeight,
  };
}

/**
 * A too-small box needs a real place in the visible photo. When it cannot be mapped there (a gallery thumbnail
 * that crops it out), the whole-thumbnail fallback that real reads use would frame the wrong thing, so it is skipped.
 * mappedBox is the box in the viewport, or null when it could not be mapped.
 */
export function canFrameTooSmall({ mappedBox }) {
  return Array.isArray(mappedBox);
}

/** Whether a too-small entry is kept, given its claim slot (null when none). It must never replace an earlier card. */
export function keepTooSmall({ claimed, mappedBox, gallery }) {
  if (!claimed || claimed.replaces != null) return false;
  return canFrameTooSmall({ mappedBox, gallery });
}

/** Cards read from one photo, and how many of them read small (a too-small card always does). Card backs are left out. */
export function smallPhotoCounts(cards, smallPx) {
  const read = (cards || []).filter((c) => !c.cardBack || c.tooSmall === true);
  const small = read.filter((c) => c.tooSmall === true || (c.readHeight > 0 && c.readHeight < smallPx)).length;
  return { read: read.length, small };
}
