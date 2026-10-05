// The screenshot viewer's zoom and pan, pure. Fit lets the image fill the
// window; any other view is a scale (1 = 100%, one image pixel per CSS pixel)
// and an offset from the centre in CSS pixels.

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export const PAN_STEP = 48;
export const PAN_STEP_LARGE = 192;

export type ViewState = { fit: boolean; scale: number; x: number; y: number };
export const FIT: ViewState = { fit: true, scale: 1, x: 0, y: 0 };
export const ACTUAL: ViewState = { fit: false, scale: 1, x: 0, y: 0 };

// The next step above or below `scale` (clamped at the ends).
export function stepScale(scale: number, direction: 1 | -1): number {
  const steps = [...ZOOM_STEPS];
  if (direction === 1) return steps.find((s) => s > scale + 1e-6) ?? 4;
  return [...steps].reverse().find((s) => s < scale - 1e-6) ?? 0.25;
}

// `shown` is the scale the image is drawn at right now (what Fit resolved to).
export function zoom(
  state: ViewState,
  direction: 1 | -1,
  shown: number,
  natural?: { w: number; h: number },
): ViewState {
  const next: ViewState = {
    fit: false,
    scale: stepScale(state.fit ? shown : state.scale, direction),
    x: state.x,
    y: state.y,
  };
  // A smaller scale narrows the pan limit: re-clamp the offset to it.
  return natural ? pan(next, 0, 0, natural) : next;
}

// Pan by (dx, dy) screen pixels, never further than half the image off centre.
export function pan(
  state: ViewState,
  dx: number,
  dy: number,
  natural: { w: number; h: number },
): ViewState {
  if (state.fit) return state;
  const limitX = (natural.w * state.scale) / 2;
  const limitY = (natural.h * state.scale) / 2;
  return {
    ...state,
    x: Math.max(-limitX, Math.min(limitX, state.x + dx)),
    y: Math.max(-limitY, Math.min(limitY, state.y + dy)),
  };
}

export const zoomLabel = (state: ViewState): string =>
  state.fit ? "Fit" : `${Math.round(state.scale * 100)}%`;

// The shortcuts, documented in the dialog and handled by one table.
export const VIEWER_KEYS: {
  keys: string;
  does: string;
  match(event: { key: string }): boolean;
  run: "in" | "out" | "fit" | "actual";
}[] = [
  {
    keys: "+",
    does: "zoom in",
    match: (e) => e.key === "+" || e.key === "=",
    run: "in",
  },
  { keys: "-", does: "zoom out", match: (e) => e.key === "-", run: "out" },
  {
    keys: "F",
    does: "fit",
    match: (e) => e.key.toLowerCase() === "f",
    run: "fit",
  },
  { keys: "1", does: "100%", match: (e) => e.key === "1", run: "actual" },
];
