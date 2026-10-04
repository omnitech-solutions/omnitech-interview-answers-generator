// A cheap perceptual hash of a frame, computed on this device (ADR-0022). The
// frame is drawn onto a 9x8 canvas, turned to grey, and each pixel is compared
// with its right-hand neighbour (a "difference hash"): 64 bits that change when
// the picture really changes and barely at all for noise. Nothing is stored or
// sent; the hash only decides WHEN a capture is worth taking.
import { cropPixels, type Rect } from "./mask-geometry";

export const HASH_COLUMNS = 9;
export const HASH_ROWS = 8;

// 64 bits as two 32-bit halves.
export type FrameHash = readonly [number, number];

// `gray` holds HASH_COLUMNS x HASH_ROWS luminance values, row by row.
export function dHash(gray: ArrayLike<number>): FrameHash {
  let high = 0;
  let low = 0;
  let bit = 0;
  for (let row = 0; row < HASH_ROWS; row += 1) {
    for (let column = 0; column < HASH_COLUMNS - 1; column += 1) {
      const at = row * HASH_COLUMNS + column;
      const set = (gray[at] ?? 0) < (gray[at + 1] ?? 0) ? 1 : 0;
      if (bit < 32) low = (low | (set << bit)) >>> 0;
      else high = (high | (set << (bit - 32))) >>> 0;
      bit += 1;
    }
  }
  return [high, low];
}

const ones = (value: number): number => {
  let rest = value >>> 0;
  let count = 0;
  while (rest !== 0) {
    rest &= rest - 1;
    count += 1;
  }
  return count;
};

// How many of the 64 bits differ.
export const hamming = (a: FrameHash, b: FrameHash): number =>
  ones(a[0] ^ b[0]) + ones(a[1] ^ b[1]);

// What sampling needs from the document, replaceable in tests.
export type SampleDeps = { createCanvas(): HTMLCanvasElement };
const browserDeps: SampleDeps = {
  createCanvas: () => document.createElement("canvas"),
};

// The hash of the shared source's current frame inside the owner's region (so
// change outside the region is never noticed), or null when no frame is ready.
export function sampleVideo(
  video: Pick<HTMLVideoElement, "videoWidth" | "videoHeight"> &
    CanvasImageSource,
  mask: Rect,
  deps: SampleDeps = browserDeps,
): FrameHash | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const { sx, sy, sw, sh } = cropPixels(mask, width, height);
  const canvas = deps.createCanvas();
  canvas.width = HASH_COLUMNS;
  canvas.height = HASH_ROWS;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, sx, sy, sw, sh, 0, 0, HASH_COLUMNS, HASH_ROWS);
  const { data } = context.getImageData(0, 0, HASH_COLUMNS, HASH_ROWS);
  const gray: number[] = [];
  for (let at = 0; at < data.length; at += 4)
    gray.push(
      ((data[at] ?? 0) * 299 +
        (data[at + 1] ?? 0) * 587 +
        (data[at + 2] ?? 0) * 114) /
        1000,
    );
  return dHash(gray);
}

// The hash of an encoded frame the host returned (already cropped to the
// owner's region by the host). Null when the image cannot be decoded here.
export async function hashImage(
  image: Blob,
  deps: SampleDeps = browserDeps,
): Promise<FrameHash | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = deps.createCanvas();
    canvas.width = HASH_COLUMNS;
    canvas.height = HASH_ROWS;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, HASH_COLUMNS, HASH_ROWS);
    const { data } = context.getImageData(0, 0, HASH_COLUMNS, HASH_ROWS);
    const gray: number[] = [];
    for (let at = 0; at < data.length; at += 4)
      gray.push(
        ((data[at] ?? 0) * 299 +
          (data[at + 1] ?? 0) * 587 +
          (data[at + 2] ?? 0) * 114) /
          1000,
      );
    return dHash(gray);
  } finally {
    bitmap.close?.();
  }
}
