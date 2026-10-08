// The sizes a coach layout keeps: its columns and the room for the call (the
// library's Splitter draws and resizes them; this is only where they are
// remembered), and the window's own width, set from a bar at its far edges.
// "Reset layout" puts all of it back.
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

const KEY = "omnitech.interview.coach.sizes";
const STEP = 24;
const SPLITTER_WIDTH = 8;
type Side = "left" | "right" | "bottom";
type Sizes = Record<string, number>;

function saved(): Sizes | undefined {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (!kept || typeof kept !== "object") return undefined;
    const sizes: Sizes = {};
    for (const [id, size] of Object.entries(kept))
      if (typeof size === "number" && Number.isFinite(size) && size >= 0)
        sizes[id] = size;
    return sizes;
  } catch {
    return undefined;
  }
}

// [DOMAIN] The sizes are the Splitter's, by panel id ("questions", "side",
// "call"). Until one is dragged there are none kept and every panel has its
// own default; a reset forgets them and tells the Splitters to go back.
export function useCoachSizes() {
  const [sizes, setSizes] = useState<Sizes | undefined>(saved);
  const [resetKey, setResetKey] = useState(0);
  // Both Splitters report into the one record.
  const latest = useRef<Sizes>(sizes ?? {});
  const keep = useCallback((next: Sizes) => {
    latest.current = { ...latest.current, ...next };
    setSizes(latest.current);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(latest.current));
    } catch {
      // The sizes still hold for this window.
    }
  }, []);
  const reset = useCallback(() => {
    latest.current = {};
    setSizes(undefined);
    setResetKey((now) => now + 1);
    setCoachWindowWidth(null);
    setCoachWindowHeight(null);
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Nothing was kept.
    }
  }, []);
  return { sizes, keep, reset, resetKey };
}

// [SAFETY] The native shell moves the window when a press travels over an
// empty drawn part of the page, and it asks about the spot the pointer has
// reached, not the bar it started on. While a bar is being dragged the whole
// page says "not here" (`data-no-drag`, which the shell honours), so resizing
// never turns into moving the window.
export function holdWindowDrag(held: boolean): void {
  if (held) document.documentElement.setAttribute("data-no-drag", "");
  else document.documentElement.removeAttribute("data-no-drag");
}

// ---- The window's own width ------------------------------------------------------

// [DOMAIN] A coach layout opens at its own width (COACH_WINDOW). Dragging the
// bar at the window's far left or far right edge makes the whole window wider
// or narrower, and that width is kept until "Reset layout". The window's fit
// (single-panel.tsx) reads it; null means the layout's own width.
const WINDOW_KEY = "omnitech.interview.coach.window-width";
export const WINDOW_FLOOR = 480;
const widthListeners = new Set<() => void>();
let windowWidth: number | null | undefined;
function readWindowWidth(): number | null {
  try {
    const kept = Number(window.localStorage.getItem(WINDOW_KEY));
    return Number.isFinite(kept) && kept >= WINDOW_FLOOR ? kept : null;
  } catch {
    return null;
  }
}
export function setCoachWindowWidth(width: number | null): void {
  const most =
    typeof window === "undefined" ? width : window.screen?.availWidth || width;
  windowWidth =
    width === null
      ? null
      : Math.round(Math.min(Math.max(width, WINDOW_FLOOR), most ?? width));
  try {
    if (windowWidth === null) window.localStorage.removeItem(WINDOW_KEY);
    else window.localStorage.setItem(WINDOW_KEY, String(windowWidth));
  } catch {
    // The width still holds for this window.
  }
  for (const listener of widthListeners) listener();
}
export function useCoachWindowWidth(): number | null {
  return useSyncExternalStore(
    (listener) => {
      widthListeners.add(listener);
      return () => widthListeners.delete(listener);
    },
    () => {
      if (windowWidth === undefined) windowWidth = readWindowWidth();
      return windowWidth;
    },
    () => null,
  );
}

// [DOMAIN] The window's height, set from the bar under the layout. The shell
// fits a height from the window's top edge, so the bottom edge follows the
// pointer one for one. null means the layout's own height.
const HEIGHT_KEY = "omnitech.interview.coach.window-height";
export const HEIGHT_FLOOR = 420;
const heightListeners = new Set<() => void>();
let windowHeight: number | null | undefined;
function readWindowHeight(): number | null {
  try {
    const kept = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(kept) && kept >= HEIGHT_FLOOR ? kept : null;
  } catch {
    return null;
  }
}
export function setCoachWindowHeight(height: number | null): void {
  const most =
    typeof window === "undefined"
      ? height
      : window.screen?.availHeight || height;
  windowHeight =
    height === null
      ? null
      : Math.round(Math.min(Math.max(height, HEIGHT_FLOOR), most ?? height));
  try {
    if (windowHeight === null) window.localStorage.removeItem(HEIGHT_KEY);
    else window.localStorage.setItem(HEIGHT_KEY, String(windowHeight));
  } catch {
    // The height still holds for this window.
  }
  for (const listener of heightListeners) listener();
}
export function useCoachWindowHeight(): number | null {
  return useSyncExternalStore(
    (listener) => {
      heightListeners.add(listener);
      return () => heightListeners.delete(listener);
    },
    () => {
      if (windowHeight === undefined) windowHeight = readWindowHeight();
      return windowHeight;
    },
    () => null,
  );
}

// The bar at one outer edge of the layout. The shell widens the window about
// its centre, so the edge follows the pointer when the width changes by twice
// the distance dragged.
export function WindowEdge({ side }: { side: Side }) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  const tall = side === "bottom";
  const outward = side === "left" ? -1 : 1;
  const now = () =>
    typeof window === "undefined"
      ? 0
      : tall
        ? window.innerHeight
        : window.innerWidth;
  // The width changes about the centre (twice the drag); the height from the top.
  const set = (size: number, moved: number) =>
    tall
      ? setCoachWindowHeight(size + moved)
      : setCoachWindowWidth(size + 2 * outward * moved);
  const release = () => {
    drag.current = null;
    holdWindowDrag(false);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={
        tall
          ? "Height of the window, from its bottom edge"
          : `Width of the window, from its ${side} edge`
      }
      aria-orientation={tall ? "vertical" : "horizontal"}
      aria-valuemin={tall ? HEIGHT_FLOOR : WINDOW_FLOOR}
      aria-valuemax={
        typeof window === "undefined"
          ? WINDOW_FLOOR
          : tall
            ? window.screen.availHeight
            : window.screen.availWidth
      }
      aria-valuenow={now()}
      title={
        tall
          ? "Drag to make the window taller or shorter. Double-click to put it back."
          : "Drag to make the window wider or narrower. Double-click to put it back."
      }
      data-hit-surface=""
      data-testid={`pn-coach-edge-${side}`}
      style={{
        flex: `0 0 ${SPLITTER_WIDTH}px`,
        display: "grid",
        placeItems: "center",
        cursor: tall ? "ns-resize" : "ew-resize",
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        drag.current = {
          at: tall ? event.screenY : event.screenX,
          size: now(),
        };
        holdWindowDrag(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        // Screen coordinates: the window itself moves under the pointer.
        set(
          drag.current.size,
          (tall ? event.screenY : event.screenX) - drag.current.at,
        );
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onDoubleClick={() =>
        tall ? setCoachWindowHeight(null) : setCoachWindowWidth(null)
      }
      onKeyDown={(event) => {
        const step = tall
          ? event.key === "ArrowDown"
            ? STEP
            : event.key === "ArrowUp"
              ? -STEP
              : null
          : event.key === "ArrowRight"
            ? outward * STEP
            : event.key === "ArrowLeft"
              ? -outward * STEP
              : null;
        if (step === null) return;
        event.preventDefault();
        set(now(), tall ? step : outward * step);
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: tall ? 44 : 4,
          height: tall ? 4 : 44,
          borderRadius: 2,
          background: "var(--ov-muted, #9aa4b2)",
          opacity: 0.6,
        }}
      />
    </div>
  );
}
