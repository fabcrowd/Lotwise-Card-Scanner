// Crop a detected card box from the source bitmap → 750×1050 OffscreenCanvas.

const OUT_W = 750;
const OUT_H = 1050;

/**
 * Crop the detected card region from sourceCanvas (or ImageBitmap) and
 * return a 750×1050 OffscreenCanvas normalised for downstream embedding.
 */
export function rectifyCard(source, box) {
  const [x1, y1, x2, y2] = box;
  const srcX = Math.max(0, Math.round(x1));
  const srcY = Math.max(0, Math.round(y1));
  const srcW = Math.round(x2) - srcX;
  const srcH = Math.round(y2) - srcY;

  const out = new OffscreenCanvas(OUT_W, OUT_H);
  if (srcW <= 0 || srcH <= 0) return out; // degenerate box — return blank canvas
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, srcX, srcY, srcW, srcH, 0, 0, OUT_W, OUT_H);
  return out;
}

/** 3x3 homography (row-major, last entry 1) taking the 4 points `src` to the 4 points `dst`. */
export function homography(src, dst) {
  const a = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  const h = a.map((row, i) => row[8] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * RGBA pixels of the quadrilateral `quad` (card order: top-left, top-right, bottom-right, bottom-left) warped to
 * outW x outH: each output pixel is mapped back into the source and sampled bilinearly, edges replicated
 * (cv2.warpPerspective with INTER_LINEAR and BORDER_REPLICATE, which the corner model's evaluation used).
 * `src` is an RGBA array of srcW x srcH whose top-left sits at (ox, oy) in the quad's coordinates.
 */
export function warpPixels(src, srcW, srcH, quad, outW, outH, ox = 0, oy = 0) {
  const m = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad.map(([x, y]) => [x - ox, y - oy]));
  const out = new Uint8ClampedArray(outW * outH * 4);
  const maxX = srcW - 1;
  const maxY = srcH - 1;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = m[6] * x + m[7] * y + m[8];
      const sx = Math.min(maxX, Math.max(0, (m[0] * x + m[1] * y + m[2]) / w));
      const sy = Math.min(maxY, Math.max(0, (m[3] * x + m[4] * y + m[5]) / w));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(maxX, x0 + 1);
      const y1 = Math.min(maxY, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * srcW + x0) * 4;
      const i01 = (y0 * srcW + x1) * 4;
      const i10 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i01 + c] - src[i00 + c]) * fx;
        const bottom = src[i10 + c] + (src[i11 + c] - src[i10 + c]) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** The card inside `quad` (source pixels, card order) of `source`, warped upright to the 750×1050 OffscreenCanvas. */
export function warpQuad(source, quad) {
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const rx = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const ry = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const rw = Math.max(1, Math.min(source.width, Math.ceil(Math.max(...xs)) + 2) - rx);
  const rh = Math.max(1, Math.min(source.height, Math.ceil(Math.max(...ys)) + 2) - ry);
  const region = new OffscreenCanvas(rw, rh);
  const rctx = region.getContext("2d", { willReadFrequently: true });
  rctx.drawImage(source, rx, ry, rw, rh, 0, 0, rw, rh);
  const pixels = warpPixels(rctx.getImageData(0, 0, rw, rh).data, rw, rh, quad, OUT_W, OUT_H, rx, ry);
  const out = new OffscreenCanvas(OUT_W, OUT_H);
  out.getContext("2d", { willReadFrequently: true }).putImageData(new ImageData(pixels, OUT_W, OUT_H), 0, 0);
  return out;
}
