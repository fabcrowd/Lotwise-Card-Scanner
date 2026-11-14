import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORNER_INPUT, CORNER_MIN_CONF, CORNER_PAD, decodePose, letterboxParams, paddedRect, validQuad } from '../tools/extension-wasm/lib/corners.js';
import { homography, warpPixels } from '../tools/extension-wasm/lib/rectify.js';

// Produced by card-scanner-data/scripts/make_corner_parity_fixture.py from the Python reference (eval_corners.py, cv2).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/corners/parity.json', import.meta.url), 'utf8'));

// Pose decoding is float32 -> float64 arithmetic on identical inputs, so only rounding in the shared formulas differs.
const POSE_TOL = 1e-6;
// cv2.warpPerspective quantises source coordinates to 1/32 px and uses 15-bit fixed-point bilinear weights; on the
// smooth fixture images that is at most 1 grey level (measured: 0, 0, 1) and a mean far below 0.05.
const WARP_MAX_DIFF = 1;
const WARP_MEAN_DIFF = 0.05;

test('constants match the trained model setup', () => {
  assert.equal(CORNER_INPUT, 320);
  assert.equal(CORNER_PAD, 0.15);
  assert.equal(CORNER_MIN_CONF, 0.8);
});

test('paddedRect matches the Python padded_crop, including clipping to the photo', () => {
  for (const c of fixture.geometry.padded) {
    assert.deepEqual(paddedRect(c.box, c.w, c.h), c.rect, JSON.stringify(c.box));
  }
});

test('letterboxParams matches Python, including half-pixel sizes (Python rounds half to even)', () => {
  for (const c of fixture.geometry.letterbox) {
    const got = letterboxParams(c.w, c.h, c.size);
    assert.equal(got.nw, c.nw, `nw ${c.w}x${c.h}`);
    assert.equal(got.nh, c.nh, `nh ${c.w}x${c.h}`);
    assert.equal(got.px, c.px, `px ${c.w}x${c.h}`);
    assert.equal(got.py, c.py, `py ${c.w}x${c.h}`);
    assert.ok(Math.abs(got.scale - c.scale) < 1e-12);
  }
});

test('decodePose takes the most confident anchor of a [1, 17, anchors] output', () => {
  const p = fixture.pose;
  const got = decodePose(Float32Array.from(p.data), p.dims);
  assert.ok(Math.abs(got.conf - p.conf) < POSE_TOL);
  got.points.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - p.letterbox_points[i][0]) < POSE_TOL, `x${i}`);
    assert.ok(Math.abs(y - p.letterbox_points[i][1]) < POSE_TOL, `y${i}`);
  });
});

test('decodePose reads the transposed [1, anchors, 17] layout the same way', () => {
  const p = fixture.pose;
  const n = p.dims[2];
  const t = new Float32Array(17 * n);
  for (let k = 0; k < 17; k++) for (let i = 0; i < n; i++) t[i * 17 + k] = p.data[k * n + i];
  const got = decodePose(t, [1, n, 17]);
  assert.ok(Math.abs(got.conf - p.conf) < POSE_TOL);
  assert.deepEqual(got.points, decodePose(Float32Array.from(p.data), p.dims).points);
});

test('un-letterboxing the decoded points gives the Python quad in photo pixels', () => {
  const p = fixture.pose;
  const [cx1, cy1, cx2, cy2] = paddedRect(p.box, p.image[0], p.image[1]);
  assert.deepEqual([cx1, cy1, cx2, cy2], p.crop_rect);
  const lb = letterboxParams(cx2 - cx1, cy2 - cy1);
  assert.equal(lb.px, p.letterbox.px);
  assert.equal(lb.py, p.letterbox.py);
  const { points } = decodePose(Float32Array.from(p.data), p.dims);
  points.forEach(([x, y], i) => {
    const qx = (x - lb.px) / lb.scale + cx1;
    const qy = (y - lb.py) / lb.scale + cy1;
    assert.ok(Math.abs(qx - p.quad_in_photo[i][0]) < 1e-3, `qx${i}`);
    assert.ok(Math.abs(qy - p.quad_in_photo[i][1]) < 1e-3, `qy${i}`);
  });
});

test('validQuad agrees with the Python valid_quad on every fixture quad', () => {
  for (const c of fixture.quads) assert.equal(validQuad(c.quad), c.valid, JSON.stringify(c.quad));
});

test('homography maps each source corner onto its destination corner', () => {
  const src = [[0, 0], [750, 0], [750, 1050], [0, 1050]];
  const dst = [[110, 90], [370, 130], [340, 520], [80, 470]];
  const m = homography(src, dst);
  assert.equal(m[8], 1);
  src.forEach(([x, y], i) => {
    const w = m[6] * x + m[7] * y + m[8];
    assert.ok(Math.abs((m[0] * x + m[1] * y + m[2]) / w - dst[i][0]) < 1e-6);
    assert.ok(Math.abs((m[3] * x + m[4] * y + m[5]) / w - dst[i][1]) < 1e-6);
  });
});

test('homography of identical point sets is the identity', () => {
  const pts = [[0, 0], [10, 0], [10, 20], [0, 20]];
  const m = homography(pts, pts);
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => assert.ok(Math.abs(m[i] - v) < 1e-9, `m${i}`));
});

test('warpPixels of the full image rectangle reproduces the image', () => {
  const w = 6, h = 4;
  const src = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 37) % 256);
  const out = warpPixels(src, w, h, [[0, 0], [w, 0], [w, h], [0, h]], w, h);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) assert.equal(out[i * 4 + c], src[i * 4 + c], `px${i} c${c}`);
    assert.equal(out[i * 4 + 3], 255);
  }
});

test('warpPixels matches cv2.warpPerspective (INTER_LINEAR, BORDER_REPLICATE) within the fixed-point tolerance', () => {
  for (const c of fixture.warps) {
    const src = new Uint8ClampedArray(c.w * c.h * 4);
    for (let i = 0; i < c.w * c.h; i++) {
      src.set(c.src_rgb.slice(i * 3, i * 3 + 3), i * 4);
      src[i * 4 + 3] = 255;
    }
    const out = warpPixels(src, c.w, c.h, c.quad, c.out_w, c.out_h, c.ox, c.oy);
    let max = 0;
    let sum = 0;
    for (let i = 0; i < c.out_w * c.out_h; i++) {
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(out[i * 4 + k] - c.expected_rgb[i * 3 + k]);
        max = Math.max(max, d);
        sum += d;
      }
    }
    const mean = sum / (c.out_w * c.out_h * 3);
    assert.ok(max <= WARP_MAX_DIFF, `${c.name}: max diff ${max}`);
    assert.ok(mean <= WARP_MEAN_DIFF, `${c.name}: mean diff ${mean}`);
  }
});
