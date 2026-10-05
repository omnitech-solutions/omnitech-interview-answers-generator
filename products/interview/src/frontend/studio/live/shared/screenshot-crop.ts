// Cropping a staged screenshot on the device: the geometry (pure, aspect-free,
// in image pixels) and the canvas that produces the NEW Blob the page then
// re-reads and sends. The crop never leaves the device before Apply.
import { LIVE_OWNER_CAPTURE_MIN_SIDE } from "@omnitech/interview-contracts";
import { fitFrame } from "../host-adapter";

export const MIN_CROP_SIDE = LIVE_OWNER_CAPTURE_MIN_SIDE;

export type CropRect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export const fullRect = (size: Size): CropRect => ({
  x: 0,
  y: 0,
  w: size.w,
  h: size.h,
});

const round = (rect: CropRect): CropRect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  w: Math.round(rect.w),
  h: Math.round(rect.h),
});

// Keeps a rectangle inside the image and at least the server's smallest side
// (an image smaller than that on a side keeps that side whole).
export function clampRect(rect: CropRect, size: Size): CropRect {
  const r = round(rect);
  const w = Math.min(size.w, Math.max(Math.min(MIN_CROP_SIDE, size.w), r.w));
  const h = Math.min(size.h, Math.max(Math.min(MIN_CROP_SIDE, size.h), r.h));
  return {
    w,
    h,
    x: Math.min(Math.max(0, r.x), size.w - w),
    y: Math.min(Math.max(0, r.y), size.h - h),
  };
}

// The handles of the selection: which edges each one moves. `move` drags the
// whole rectangle.
export const CROP_HANDLES = [
  { id: "nw", label: "top left", dx: -1, dy: -1 },
  { id: "n", label: "top", dx: 0, dy: -1 },
  { id: "ne", label: "top right", dx: 1, dy: -1 },
  { id: "e", label: "right", dx: 1, dy: 0 },
  { id: "se", label: "bottom right", dx: 1, dy: 1 },
  { id: "s", label: "bottom", dx: 0, dy: 1 },
  { id: "sw", label: "bottom left", dx: -1, dy: 1 },
  { id: "w", label: "left", dx: -1, dy: 0 },
] as const;
export type CropHandleId = (typeof CROP_HANDLES)[number]["id"] | "move";

// The rectangle after dragging `handle` by (dx, dy) image pixels from `start`.
export function dragRect(
  start: CropRect,
  handle: CropHandleId,
  dx: number,
  dy: number,
  size: Size,
): CropRect {
  if (handle === "move")
    return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, size);
  const edge = CROP_HANDLES.find((each) => each.id === handle);
  if (!edge) return start;
  let { x, y, w, h } = start;
  if (edge.dx === 1) w = start.w + dx;
  if (edge.dx === -1) {
    x = start.x + dx;
    w = start.w - dx;
  }
  if (edge.dy === 1) h = start.h + dy;
  if (edge.dy === -1) {
    y = start.y + dy;
    h = start.h - dy;
  }
  // Dragging past the opposite edge stops at the smallest side instead of
  // flipping; the dragged edge never leaves the image.
  const minW = Math.min(MIN_CROP_SIDE, size.w);
  const minH = Math.min(MIN_CROP_SIDE, size.h);
  if (edge.dx === -1) {
    x = Math.min(Math.max(0, x), start.x + start.w - minW);
    w = start.x + start.w - x;
  } else w = Math.min(Math.max(minW, w), size.w - start.x);
  if (edge.dy === -1) {
    y = Math.min(Math.max(0, y), start.y + start.h - minH);
    h = start.y + start.h - y;
  } else h = Math.min(Math.max(minH, h), size.h - start.y);
  return clampRect({ x, y, w, h }, size);
}

// A new selection dragged out from one corner to another.
export function rectBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: Size,
): CropRect {
  return clampRect(
    {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y),
    },
    size,
  );
}

// Numeric entry: one field changed, the rest kept, always inside the image.
export function withField(
  rect: CropRect,
  field: keyof CropRect,
  value: number,
  size: Size,
): CropRect {
  return clampRect(
    { ...rect, [field]: Number.isFinite(value) ? value : 0 },
    size,
  );
}

export const isWholeImage = (rect: CropRect, size: Size): boolean =>
  rect.x === 0 && rect.y === 0 && rect.w === size.w && rect.h === size.h;

// The cropped image as a NEW Blob (the source type for JPEG and WebP, else PNG),
// re-encoded smaller if it is still over the upload bound. Rejects when the
// result would be under the smallest side the server accepts.
export async function cropBlob(blob: Blob, rect: CropRect): Promise<Blob> {
  if (rect.w < MIN_CROP_SIDE || rect.h < MIN_CROP_SIDE)
    throw new Error("too-small");
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = rect.w;
    canvas.height = rect.h;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no-canvas");
    context.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      rect.w,
      rect.h,
    );
    const type =
      blob.type === "image/jpeg" || blob.type === "image/webp"
        ? blob.type
        : "image/png";
    const cropped = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("encode"))),
        type,
        0.92,
      ),
    );
    return await fitFrame(cropped);
  } finally {
    bitmap.close?.();
  }
}
