// A pixel-buffer stand-in for the browser's OffscreenCanvas, with only the calls the extension's scanning modules
// make (lib/detect.js, embed.js, rectify.js, ocr.js): drawImage, getImageData, putImageData and fillRect.
// React Native has no canvas. Resampling here is a box filter when shrinking and bilinear when enlarging, which is
// not byte-identical to Chrome's, so scores can differ slightly from the extension's for the same photo.

export interface PixelSource {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

const CHANNELS = 4;
const OPAQUE = 255;

export class PixelImageData {
  constructor(
    public readonly data: Uint8ClampedArray,
    public readonly width: number,
    public readonly height: number,
  ) {}
}

interface AxisTaps {
  /** Taps per output pixel. */
  readonly span: number;
  readonly index: Int32Array;
  readonly weight: Float32Array;
}

/**
 * For each output pixel along one axis, the source pixels it reads and their weights. Reads never leave the source
 * rectangle (its edge pixel is repeated), as on a browser canvas: a crop does not pick up the pixels next to it.
 */
function axisTaps(srcStart: number, srcSize: number, dstSize: number, srcLimit: number): AxisTaps {
  const first = Math.max(0, Math.min(srcLimit - 1, Math.floor(srcStart)));
  const last = Math.max(first, Math.min(srcLimit - 1, Math.ceil(srcStart + srcSize) - 1));
  const scale = srcSize / dstSize;
  const shrinking = scale > 1;
  const span = shrinking ? Math.ceil(scale) + 1 : 2;
  const index = new Int32Array(dstSize * span);
  const weight = new Float32Array(dstSize * span);
  const clamp = (at: number): number => Math.min(last, Math.max(first, at));
  for (let i = 0; i < dstSize; i++) {
    const from = srcStart + i * scale;
    const base = i * span;
    if (!shrinking) {
      const center = from + scale / 2 - 0.5;
      const low = Math.floor(center);
      const t = center - low;
      index[base] = clamp(low);
      weight[base] = 1 - t;
      index[base + 1] = clamp(low + 1);
      weight[base + 1] = t;
      continue;
    }
    const to = from + scale;
    let tap = 0;
    for (let p = Math.floor(from); p < to && tap < span; p++, tap++) {
      const overlap = Math.min(to, p + 1) - Math.max(from, p);
      index[base + tap] = clamp(p);
      weight[base + tap] = Math.max(0, overlap) / scale;
    }
  }
  return { span, index, weight };
}

/** The source rectangle resampled to dw x dh, as RGBA bytes. Pixels outside the source repeat its edge. */
export function resample(
  src: PixelSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * CHANNELS);
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0 || src.width <= 0 || src.height <= 0) return out;
  const xs = axisTaps(sx, sw, dw, src.width);
  const ys = axisTaps(sy, sh, dh, src.height);
  const rowFirst = Math.max(0, Math.min(src.height - 1, Math.floor(sy)));
  const rowLast = Math.max(rowFirst, Math.min(src.height - 1, Math.ceil(sy + sh) - 1));
  const rows = rowLast - rowFirst + 1;
  const wide = new Float32Array(rows * dw * 3);
  for (let r = 0; r < rows; r++) {
    const srcRow = (rowFirst + r) * src.width * CHANNELS;
    for (let x = 0; x < dw; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      const base = x * xs.span;
      for (let tap = 0; tap < xs.span; tap++) {
        const w = xs.weight[base + tap];
        if (w === 0) continue;
        const at = srcRow + xs.index[base + tap] * CHANNELS;
        red += src.data[at] * w;
        green += src.data[at + 1] * w;
        blue += src.data[at + 2] * w;
      }
      const to = (r * dw + x) * 3;
      wide[to] = red;
      wide[to + 1] = green;
      wide[to + 2] = blue;
    }
  }
  for (let y = 0; y < dh; y++) {
    const base = y * ys.span;
    for (let x = 0; x < dw; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let tap = 0; tap < ys.span; tap++) {
        const w = ys.weight[base + tap];
        if (w === 0) continue;
        const row = Math.min(rows - 1, Math.max(0, ys.index[base + tap] - rowFirst));
        const at = (row * dw + x) * 3;
        red += wide[at] * w;
        green += wide[at + 1] * w;
        blue += wide[at + 2] * w;
      }
      const to = (y * dw + x) * CHANNELS;
      // A clamped byte array rounds to the nearest whole number by itself.
      out[to] = red;
      out[to + 1] = green;
      out[to + 2] = blue;
      out[to + 3] = OPAQUE;
    }
  }
  return out;
}

function parseFill(style: string): [number, number, number] {
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(style);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(style);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  return [0, 0, 0];
}

export class PixelContext {
  fillStyle = '#000000';
  imageSmoothingQuality = 'low';
  // Accepted so the extension's code can set it. Nothing in the mobile pipeline asks for a filtered draw.
  filter = 'none';

  constructor(private readonly canvas: PixelCanvas) {}

  fillRect(x: number, y: number, w: number, h: number): void {
    const [red, green, blue] = parseFill(this.fillStyle);
    const { width, height, data } = this.canvas;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(width, Math.round(x + w));
    const y1 = Math.min(height, Math.round(y + h));
    for (let row = y0; row < y1; row++) {
      for (let col = x0; col < x1; col++) {
        const at = (row * width + col) * CHANNELS;
        data[at] = red;
        data[at + 1] = green;
        data[at + 2] = blue;
        data[at + 3] = OPAQUE;
      }
    }
  }

  /** drawImage(src, dx, dy) | (src, dx, dy, dw, dh) | (src, sx, sy, sw, sh, dx, dy, dw, dh), as on a browser canvas. */
  drawImage(src: PixelSource, ...args: number[]): void {
    let rect: number[];
    if (args.length === 2) rect = [0, 0, src.width, src.height, args[0], args[1], src.width, src.height];
    else if (args.length === 4) rect = [0, 0, src.width, src.height, ...args];
    else if (args.length === 8) rect = args;
    else throw new Error(`drawImage takes 3, 5 or 9 arguments, got ${args.length + 1}`);
    const [sx, sy, sw, sh, dx, dy] = rect;
    const dw = Math.round(rect[6]);
    const dh = Math.round(rect[7]);
    this.blit(resample(src, sx, sy, sw, sh, dw, dh), dw, dh, Math.round(dx), Math.round(dy));
  }

  getImageData(x: number, y: number, w: number, h: number): PixelImageData {
    const { width, height, data } = this.canvas;
    const out = new Uint8ClampedArray(w * h * CHANNELS);
    for (let row = 0; row < h; row++) {
      const srcRow = y + row;
      if (srcRow < 0 || srcRow >= height) continue;
      for (let col = 0; col < w; col++) {
        const srcCol = x + col;
        if (srcCol < 0 || srcCol >= width) continue;
        const from = (srcRow * width + srcCol) * CHANNELS;
        out.set(data.subarray(from, from + CHANNELS), (row * w + col) * CHANNELS);
      }
    }
    return new PixelImageData(out, w, h);
  }

  putImageData(image: PixelSource, dx: number, dy: number): void {
    this.blit(image.data, image.width, image.height, Math.round(dx), Math.round(dy));
  }

  private blit(pixels: Uint8ClampedArray | Uint8Array, w: number, h: number, dx: number, dy: number): void {
    const { width, height, data } = this.canvas;
    for (let row = 0; row < h; row++) {
      const toRow = dy + row;
      if (toRow < 0 || toRow >= height) continue;
      for (let col = 0; col < w; col++) {
        const toCol = dx + col;
        if (toCol < 0 || toCol >= width) continue;
        const from = (row * w + col) * CHANNELS;
        data.set(pixels.subarray(from, from + CHANNELS), (toRow * width + toCol) * CHANNELS);
      }
    }
  }
}

export class PixelCanvas implements PixelSource {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  private readonly context: PixelContext;

  constructor(width: number, height: number, data?: Uint8ClampedArray | Uint8Array) {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    const bytes = this.width * this.height * CHANNELS;
    if (data && data.length !== bytes) throw new Error(`Expected ${bytes} pixel bytes, got ${data.length}`);
    this.data = data ? new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) : new Uint8ClampedArray(bytes);
    this.context = new PixelContext(this);
  }

  getContext(_kind?: string, _options?: unknown): PixelContext {
    return this.context;
  }
}
