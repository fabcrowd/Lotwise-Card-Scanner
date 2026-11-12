// Second-stage corner model: the 4 corners of the card inside a detector box, in the card's own order (top-left,
// top-right, bottom-right, bottom-left of the printed card), so a sideways, upside-down, tilted or loosely boxed card can
// be warped upright before it is read. YOLO11n-pose trained on real lot photos (card-scanner-data train/corners,
// pose_real_v1; result in data/reports/fresh-20261111). Input: the box padded by CORNER_PAD per side, letterboxed to
// CORNER_INPUT. Uses globalThis.ort set by background.js before any of these functions run.

export const CORNER_INPUT = 320;
export const CORNER_PAD = 0.15;
export const CORNER_MIN_CONF = 0.8;
const PAD_COLOR = 114;

let _session = null;

export async function loadCornerModel(modelBuffer) {
  _session = await globalThis.ort.InferenceSession.create(modelBuffer, { executionProviders: ["wasm"] });
}

export function cornerModelReady() {
  return _session !== null;
}

/** The detector box padded by CORNER_PAD per side and clipped to the source, in whole pixels as in training. */
export function paddedRect([x1, y1, x2, y2], width, height) {
  const px = (x2 - x1) * CORNER_PAD;
  const py = (y2 - y1) * CORNER_PAD;
  return [
    Math.trunc(Math.max(0, x1 - px)),
    Math.trunc(Math.max(0, y1 - py)),
    Math.min(width, Math.ceil(x2 + px)),
    Math.min(height, Math.ceil(y2 + py)),
  ];
}

// Python's round(), which the model was trained and evaluated with, rounds exact halves to the even integer.
function roundHalfEven(v) {
  const f = Math.floor(v);
  const d = v - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(v);
}

/** Placement of a w x h crop inside the size x size letterbox (aspect kept, centred). */
export function letterboxParams(w, h, size = CORNER_INPUT) {
  const scale = Math.min(size / w, size / h);
  const nw = roundHalfEven(w * scale);
  const nh = roundHalfEven(h * scale);
  return { scale, nw, nh, px: Math.floor((size - nw) / 2), py: Math.floor((size - nh) / 2) };
}

/**
 * The most confident detection of a YOLO pose output with one class and 4 keypoints: [1, 17, anchors] (box 4, score 1,
 * keypoints 4 x (x, y, visibility)) or the transposed [1, anchors, 17]. Points are in letterbox pixels.
 * @returns {{conf: number, points: number[][]}}
 */
export function decodePose(data, dims) {
  const attrs = 17;
  const anchorsFirst = dims[1] !== attrs && dims[2] === attrs;
  const n = anchorsFirst ? dims[1] : dims[2];
  const at = anchorsFirst ? (k, i) => data[i * attrs + k] : (k, i) => data[k * n + i];
  let best = 0;
  for (let i = 1; i < n; i++) if (at(4, i) > at(4, best)) best = i;
  const points = [0, 1, 2, 3].map((k) => [at(5 + 3 * k, best), at(6 + 3 * k, best)]);
  return { conf: at(4, best), points };
}

/** Convex, wound one way, sides of at least 8 px and a card-like side ratio (same test as the offline evaluation). */
export function validQuad(q) {
  const cross = [0, 1, 2, 3].map((i) => {
    const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  if (!(cross.every((v) => v > 0) || cross.every((v) => v < 0))) return false;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return Math.min(w, h) >= 8 && h / w >= 0.9 && h / w <= 2.2;
}

/**
 * Corners of the card in `box` of `source` (ImageBitmap or canvas), in source pixels, card order.
 * @returns {Promise<{conf: number, quad: number[][]} | null>} null when the padded box is too small
 */
export async function predictCorners(source, box) {
  if (!_session) throw new Error("Corner model not loaded");
  const [cx1, cy1, cx2, cy2] = paddedRect(box, source.width, source.height);
  const cw = cx2 - cx1;
  const ch = cy2 - cy1;
  if (cw < 2 || ch < 2) return null;
  const { scale, nw, nh, px, py } = letterboxParams(cw, ch);
  const canvas = new OffscreenCanvas(CORNER_INPUT, CORNER_INPUT);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = `rgb(${PAD_COLOR},${PAD_COLOR},${PAD_COLOR})`;
  ctx.fillRect(0, 0, CORNER_INPUT, CORNER_INPUT);
  ctx.drawImage(source, cx1, cy1, cw, ch, px, py, nw, nh);
  const rgba = ctx.getImageData(0, 0, CORNER_INPUT, CORNER_INPUT).data;
  const plane = CORNER_INPUT * CORNER_INPUT;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    tensor[i] = rgba[i * 4] / 255;
    tensor[plane + i] = rgba[i * 4 + 1] / 255;
    tensor[2 * plane + i] = rgba[i * 4 + 2] / 255;
  }
  const results = await _session.run({ images: new globalThis.ort.Tensor("float32", tensor, [1, 3, CORNER_INPUT, CORNER_INPUT]) });
  const out = results[Object.keys(results)[0]];
  const { conf, points } = decodePose(out.data, out.dims);
  return { conf, quad: points.map(([x, y]) => [(x - px) / scale + cx1, (y - py) / scale + cy1]) };
}
