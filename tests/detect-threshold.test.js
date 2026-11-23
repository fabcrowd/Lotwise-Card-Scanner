import { test } from "node:test";
import assert from "node:assert/strict";

// A fake detector session: one anchor with a card score of 0.3, between the lowered 0.12 and the default 0.55 floors.
const ANCHORS = 10;
const output = new Float32Array(5 * ANCHORS);
output[0] = 320; output[ANCHORS] = 320; output[2 * ANCHORS] = 100; output[3 * ANCHORS] = 100; output[4 * ANCHORS] = 0.3;

globalThis.ort = {
  Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } },
  InferenceSession: {
    create: async () => ({
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // lets overlapping scans interleave
        return { output: { data: output, dims: [1, 5, ANCHORS] } };
      },
    }),
  },
};
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    const { width, height } = this;
    return { fillRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }) };
  }
};

const { loadDetector, detectCards, getConfThreshold } = await import("../tools/extension-wasm/lib/detect.js");
await loadDetector(new ArrayBuffer(1));
const photo = { width: 640, height: 640 };

test("a threshold passed to one scan applies to that scan only", async () => {
  const before = getConfThreshold();
  assert.equal((await detectCards(photo)).length, 0);
  assert.equal((await detectCards(photo, 0.12)).length, 1);
  assert.equal(getConfThreshold(), before);
});

test("two overlapping scans, one with a lowered floor, leave the default floor in place", async () => {
  const before = getConfThreshold();
  const [lowered, normal] = await Promise.all([detectCards(photo, 0.12), detectCards(photo)]);
  assert.equal(lowered.length, 1);
  assert.equal(normal.length, 0);
  assert.equal(getConfThreshold(), before);
});
