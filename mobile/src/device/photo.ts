// Turns a photo file into pixels the scanning modules can read, and cuts a small picture of one card for the lists.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

import type { Box } from '../core/types';
import { PixelCanvas } from '../platform/canvas';

export interface Photo {
  uri: string;
  width: number;
  height: number;
}

export interface DecodedPhoto {
  canvas: PixelCanvas;
  /** Decoded pixels per pixel of the photo file. 1 when the photo was not shrunk. */
  scale: number;
}

// Decoding a full 12 MP photo in JavaScript would take seconds, so the photo is read at this size. A card filling the
// frame is then about 1,400 px tall, above every height limit in the extension's rules. With many cards in one photo
// each is smaller: the title is still read (200 px), but the collector number needs 600 px, about four cards a photo.
const MAX_SIDE = 1600;
const DECODE_QUALITY = 0.92;
const CROP_WIDTH = 360;
const CROP_QUALITY = 0.8;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function decodePhoto(photo: Photo): Promise<DecodedPhoto> {
  const longest = Math.max(photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.uri);
  // Only the longest side is trusted: a camera file can report its width and height before rotation is applied.
  if (longest > MAX_SIDE) {
    context.resize(photo.width >= photo.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: DECODE_QUALITY, base64: true });
  if (!saved.base64) throw new Error('The photo could not be read. Try taking it again.');
  const { data, width, height } = decode(base64ToBytes(saved.base64), { useTArray: true, formatAsRGBA: true });
  const scale = longest > 0 ? Math.max(width, height) / longest : 1;
  return { canvas: new PixelCanvas(width, height, data), scale: Math.min(1, scale) };
}

/** A small JPEG of one card, cut from the photo file. `box` is in decoded pixels. Null when the cut fails. */
export async function cropCard(photo: Photo, box: Box, scale: number): Promise<string | null> {
  const [x1, y1, x2, y2] = box.map((value) => value / scale);
  const rect = {
    originX: Math.max(0, Math.round(x1)),
    originY: Math.max(0, Math.round(y1)),
    width: Math.max(1, Math.round(x2 - x1)),
    height: Math.max(1, Math.round(y2 - y1)),
  };
  try {
    const image = await ImageManipulator.manipulate(photo.uri).crop(rect).resize({ width: CROP_WIDTH }).renderAsync();
    return (await image.saveAsync({ format: SaveFormat.JPEG, compress: CROP_QUALITY })).uri;
  } catch (err) {
    console.error('[photo] card picture not cut:', err instanceof Error ? err.message : err);
    return null;
  }
}
