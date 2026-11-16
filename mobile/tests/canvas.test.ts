import { rectifyCard } from '../src/core/ext';
import { PixelCanvas, PixelImageData, resample } from '../src/platform/canvas';
import { installPlatform } from '../src/platform/install';

/** A canvas where pixel (x, y) has red = x * 10 and green = y * 10. */
function gradient(width: number, height: number): PixelCanvas {
  const canvas = new PixelCanvas(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) canvas.data.set([x * 10, y * 10, 0, 255], (y * width + x) * 4);
  }
  return canvas;
}

const pixel = (canvas: { data: ArrayLike<number>; width: number }, x: number, y: number): number[] =>
  Array.from({ length: 4 }, (_, channel) => canvas.data[(y * canvas.width + x) * 4 + channel]);

beforeAll(() => installPlatform());

test('copying at the same size changes nothing', () => {
  const source = gradient(6, 5);
  expect(Array.from(resample(source, 0, 0, 6, 5, 6, 5))).toEqual(Array.from(source.data));
});

test('odd and even values both survive a same-size copy (no rounding drift)', () => {
  const source = new PixelCanvas(4, 1);
  [11, 10, 255, 1].forEach((red, x) => source.data.set([red, red, red, 255], x * 4));
  const reds = Array.from(resample(source, 0, 0, 4, 1, 4, 1)).filter((_, i) => i % 4 === 0);
  expect(reds).toEqual([11, 10, 255, 1]);
});

test('shrinking averages the pixels each output pixel covers', () => {
  const source = new PixelCanvas(4, 2);
  [0, 100, 20, 40].forEach((red, x) => {
    source.data.set([red, 0, 0, 255], x * 4);
    source.data.set([red, 0, 0, 255], (4 + x) * 4);
  });
  const out = resample(source, 0, 0, 4, 2, 2, 1);
  expect([out[0], out[4]]).toEqual([50, 30]);
  expect(out[3]).toBe(255);
});

test('enlarging blends between neighbors and keeps the edges', () => {
  const source = new PixelCanvas(2, 1);
  source.data.set([0, 0, 0, 255, 200, 0, 0, 255]);
  const reds = Array.from(resample(source, 0, 0, 2, 1, 4, 1)).filter((_, i) => i % 4 === 0);
  expect(reds).toEqual([0, 50, 150, 200]);
});

test('drawImage with nine arguments crops then scales, as the extension uses it', () => {
  const source = gradient(8, 8);
  const out = new PixelCanvas(2, 2);
  out.getContext('2d').drawImage(source, 4, 2, 2, 2, 0, 0, 2, 2);
  expect(pixel(out, 0, 0)).toEqual([40, 20, 0, 255]);
  expect(pixel(out, 1, 1)).toEqual([50, 30, 0, 255]);
});

test('drawImage with five arguments scales the whole source into the given rectangle', () => {
  const source = new PixelCanvas(2, 2);
  source.getContext('2d').fillStyle = 'rgb(10, 20, 30)';
  source.getContext('2d').fillRect(0, 0, 2, 2);
  const out = new PixelCanvas(4, 4);
  out.getContext('2d').drawImage(source, 1, 1, 2, 2);
  expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(pixel(out, 2, 2)).toEqual([10, 20, 30, 255]);
  expect(pixel(out, 3, 3)).toEqual([0, 0, 0, 0]);
});

test('getImageData and putImageData round-trip a region', () => {
  const source = gradient(5, 5);
  const region = source.getContext('2d').getImageData(1, 2, 2, 2);
  expect(region).toBeInstanceOf(PixelImageData);
  expect(Array.from(region.data.subarray(0, 4))).toEqual([10, 20, 0, 255]);
  const out = new PixelCanvas(3, 3);
  out.getContext('2d').putImageData(region, 1, 1);
  expect(pixel(out, 2, 2)).toEqual([20, 30, 0, 255]);
  expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 0]);
});

test('fillRect reads the rgb() and hex colors the extension sets', () => {
  const canvas = new PixelCanvas(2, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgb(114,114,114)';
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = '#ff8000';
  context.fillRect(1, 0, 1, 1);
  expect(pixel(canvas, 0, 0)).toEqual([114, 114, 114, 255]);
  expect(pixel(canvas, 1, 0)).toEqual([255, 128, 0, 255]);
});

test('pixel data of the wrong length is refused', () => {
  expect(() => new PixelCanvas(2, 2, new Uint8Array(15))).toThrow(/Expected 16 pixel bytes/);
});

test("the extension's own crop function runs on this canvas and returns its 750 x 1050 card", () => {
  const photo = new PixelCanvas(40, 60);
  const context = photo.getContext('2d');
  context.fillStyle = 'rgb(200, 10, 10)';
  context.fillRect(10, 10, 20, 28);
  const cropped = rectifyCard(photo, [10, 10, 30, 38]) as PixelCanvas;
  expect([cropped.width, cropped.height]).toEqual([750, 1050]);
  expect(pixel(cropped, 375, 525)).toEqual([200, 10, 10, 255]);
  expect(pixel(cropped, 5, 5)).toEqual([200, 10, 10, 255]);
});
