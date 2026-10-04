// The capture region as a rectangle normalized to the shared source: x, y, w, h
// in 0..1. Pure geometry for the mask editor and for cropping a frame.
export type Rect = { x: number; y: number; w: number; h: number };
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
// A region smaller than this is not a region.
export const MIN_SIZE = 0.05;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);
const round = (value: number): number => Math.round(value * 10_000) / 10_000;

// Keeps a rectangle inside the source and at least MIN_SIZE on each side.
export function clampRect(rect: Rect): Rect {
  const w = clamp(rect.w, MIN_SIZE, 1);
  const h = clamp(rect.h, MIN_SIZE, 1);
  return {
    x: round(clamp(rect.x, 0, 1 - w)),
    y: round(clamp(rect.y, 0, 1 - h)),
    w: round(w),
    h: round(h),
  };
}

export const moveRect = (rect: Rect, dx: number, dy: number): Rect =>
  clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy });

// Moves one edge or corner; the opposite one stays where it is.
export function resizeRect(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_SIZE);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_SIZE, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_SIZE);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_SIZE, 1);
  return clampRect({ x: left, y: top, w: right - left, h: bottom - top });
}

// Grows or shrinks around the centre (keyboard resize).
export function growRect(rect: Rect, dw: number, dh: number): Rect {
  const w = clamp(rect.w + dw, MIN_SIZE, 1);
  const h = clamp(rect.h + dh, MIN_SIZE, 1);
  return clampRect({
    x: rect.x - (w - rect.w) / 2,
    y: rect.y - (h - rect.h) / 2,
    w,
    h,
  });
}

// Presets are shown as icons; the label is their accessible name and tooltip.
export const PRESETS = [
  { id: "full", label: "Everything", part: "Everything on", rect: FULL },
  {
    id: "left",
    label: "Left side",
    part: "Left half of",
    rect: { x: 0, y: 0, w: 0.5, h: 1 },
  },
  {
    id: "right",
    label: "Right side",
    part: "Right half of",
    rect: { x: 0.5, y: 0, w: 0.5, h: 1 },
  },
  {
    id: "top",
    label: "Top",
    part: "Top half of",
    rect: { x: 0, y: 0, w: 1, h: 0.5 },
  },
  {
    id: "bottom",
    label: "Bottom",
    part: "Bottom half of",
    rect: { x: 0, y: 0.5, w: 1, h: 0.5 },
  },
  {
    id: "center",
    label: "Middle",
    part: "Middle of",
    rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  },
] as const satisfies readonly {
  id: string;
  label: string;
  part: string;
  rect: Rect;
}[];

const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

// The area in plain words, e.g. "Left half of the shared screen".
export function describeArea(rect: Rect, subject: string): string {
  const preset = PRESETS.find(
    (p) =>
      near(p.rect.x, rect.x) &&
      near(p.rect.y, rect.y) &&
      near(p.rect.w, rect.w) &&
      near(p.rect.h, rect.h),
  );
  if (preset) return `${preset.part} ${subject}`;
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  return `A custom area of ${subject}: ${pct(rect.w)} of the width, ${pct(rect.h)} of the height`;
}

export const isFull = (rect: Rect): boolean =>
  rect.x <= 0 && rect.y <= 0 && rect.w >= 1 && rect.h >= 1;

// The pixel rectangle of a region in a source of the given size (whole pixels,
// at least one, inside the source).
export function cropPixels(
  rect: Rect,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = clamp(Math.round(rect.x * width), 0, width - 1);
  const sy = clamp(Math.round(rect.y * height), 0, height - 1);
  const sw = clamp(Math.round(rect.w * width), 1, width - sx);
  const sh = clamp(Math.round(rect.h * height), 1, height - sy);
  return { sx, sy, sw, sh };
}

// The size to draw a (cropped) region at: the long side at most `max`.
export function fitSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// A region as the capture request wants it: normalised to the main display and
// guaranteed to fit inside it (x + width and y + height never exceed 1).
export function toDisplayRegion(rect: Rect): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const floor = (value: number) => Math.floor(value * 10_000) / 10_000;
  const x = floor(clamp(rect.x, 0, 1 - MIN_SIZE));
  const y = floor(clamp(rect.y, 0, 1 - MIN_SIZE));
  return {
    x,
    y,
    width: Math.max(MIN_SIZE, floor(Math.min(rect.w, 1 - x))),
    height: Math.max(MIN_SIZE, floor(Math.min(rect.h, 1 - y))),
  };
}
