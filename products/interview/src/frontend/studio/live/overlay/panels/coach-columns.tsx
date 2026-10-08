// The widths of a coach layout's side columns. Each is resized by dragging the
// bar between it and the centre (or with the arrow keys), from nothing to as
// wide as the window allows while the centre keeps its floor; a double click
// on a bar puts that column back, and "Reset layout" puts everything back.
// The widths are kept for the next session.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QUESTIONS_WIDTH, RIGHT_WIDTH } from "./chat-view-pref";

const KEY = "omnitech.interview.coach.columns";
const STEP = 24;
// What the centre (the call and the notes) always keeps.
export const CENTRE_FLOOR = 320;
// The questions are a list to glance at, never a column to read across: it is
// not widened past this, however much room the window has.
export const QUESTIONS_CEILING = 360;
// The bar stands in the gap between two columns.
export const SPLITTER_WIDTH = 8;
// Sent to everything in the layout that keeps a size of its own (the call slot).
export const COACH_LAYOUT_RESET = "omnitech:coach-layout-reset";

export type Side = "left" | "right";
type Columns = Record<Side, number>;
const DEFAULTS: Columns = { left: QUESTIONS_WIDTH, right: RIGHT_WIDTH };

function saved(): Columns {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    const width = (side: Side) =>
      Number.isFinite(kept?.[side]) && kept[side] >= 0
        ? Math.min(
            Number(kept[side]),
            side === "left" ? QUESTIONS_CEILING : Number.POSITIVE_INFINITY,
          )
        : DEFAULTS[side];
    return { left: width("left"), right: width("right") };
  } catch {
    return DEFAULTS;
  }
}

export function useCoachColumns() {
  const [columns, setColumns] = useState<Columns>(saved);
  // The row the columns stand in: its width is what there is to share.
  const row = useRef<HTMLDivElement>(null);
  const keep = (next: Columns) => {
    setColumns(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // The widths still hold for this window.
    }
  };
  // [GUARD] A column is never wider than what the other column and the
  // centre's floor leave of the row, and never narrower than nothing.
  const ceiling = (side: Side) => {
    const other = columns[side === "left" ? "right" : "left"];
    const total = row.current?.clientWidth ?? Number.POSITIVE_INFINITY;
    const room = Math.max(0, total - other - CENTRE_FLOOR - SPLITTER_WIDTH * 4);
    return side === "left" ? Math.min(room, QUESTIONS_CEILING) : room;
  };
  const resize = (side: Side, width: number) =>
    keep({
      ...columns,
      [side]: Math.round(Math.min(Math.max(width, 0), ceiling(side))),
    });
  return {
    row,
    columns,
    resize,
    ceiling,
    resetSide: (side: Side) => keep({ ...columns, [side]: DEFAULTS[side] }),
    reset: () => {
      keep(DEFAULTS);
      setCoachWindowWidth(null);
      window.dispatchEvent(new Event(COACH_LAYOUT_RESET));
    },
  };
}

// Runs `onReset` when the layout is reset.
export function useLayoutReset(onReset: () => void): void {
  const latest = useRef(onReset);
  latest.current = onReset;
  useEffect(() => {
    const reset = () => latest.current();
    window.addEventListener(COACH_LAYOUT_RESET, reset);
    return () => window.removeEventListener(COACH_LAYOUT_RESET, reset);
  }, []);
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

const LABEL: Record<Side, string> = {
  left: "Width of the questions column",
  right: "Width of the right column",
};

export function ColumnSplitter({
  side,
  width,
  max,
  onResize,
  onReset,
}: {
  side: Side;
  width: number;
  max: number;
  onResize(width: number): void;
  onReset(): void;
}) {
  // Where the drag began: the pointer's place on screen and the column's width.
  const drag = useRef<{ x: number; width: number } | null>(null);
  // Dragging right widens the left column and narrows the right one.
  const sign = side === "left" ? 1 : -1;
  return (
    // A slider, so the shell treats it as a control and never drags the window
    // from it; a surface of its own, so it takes the mouse.
    <div
      role="slider"
      tabIndex={0}
      aria-label={LABEL[side]}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Number.isFinite(max) ? max : width}
      aria-valuenow={width}
      title="Drag to resize. Double-click to put this column back."
      data-hit-surface=""
      data-testid={`pn-coach-splitter-${side}`}
      style={{
        flex: `0 0 ${SPLITTER_WIDTH}px`,
        display: "grid",
        placeItems: "center",
        cursor: "ew-resize",
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width };
        holdWindowDrag(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onResize(drag.current.width + sign * (event.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        drag.current = null;
        holdWindowDrag(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        holdWindowDrag(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowRight"
            ? width + sign * STEP
            : event.key === "ArrowLeft"
              ? width - sign * STEP
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? max
                  : null;
        if (next === null) return;
        event.preventDefault();
        onResize(next);
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 4,
          height: 44,
          borderRadius: 2,
          background: "var(--ov-muted, #9aa4b2)",
          opacity: 0.6,
        }}
      />
    </div>
  );
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

// The bar at one outer edge of the layout. The shell widens the window about
// its centre, so the edge follows the pointer when the width changes by twice
// the distance dragged.
export function WindowEdge({ side }: { side: Side }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const outward = side === "left" ? -1 : 1;
  const now = () => (typeof window === "undefined" ? 0 : window.innerWidth);
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`Width of the window, from its ${side} edge`}
      aria-orientation="horizontal"
      aria-valuemin={WINDOW_FLOOR}
      aria-valuemax={
        typeof window === "undefined" ? WINDOW_FLOOR : window.screen.availWidth
      }
      aria-valuenow={now()}
      title="Drag to make the window wider or narrower. Double-click to put it back."
      data-hit-surface=""
      data-testid={`pn-coach-edge-${side}`}
      style={{
        flex: `0 0 ${SPLITTER_WIDTH}px`,
        display: "grid",
        placeItems: "center",
        cursor: "ew-resize",
        touchAction: "none",
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.screenX, width: now() };
        holdWindowDrag(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        // Screen coordinates: the window itself moves under the pointer.
        setCoachWindowWidth(
          drag.current.width + 2 * outward * (event.screenX - drag.current.x),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
        holdWindowDrag(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        holdWindowDrag(false);
      }}
      onDoubleClick={() => setCoachWindowWidth(null)}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowRight"
            ? outward * STEP
            : event.key === "ArrowLeft"
              ? -outward * STEP
              : null;
        if (step === null) return;
        event.preventDefault();
        setCoachWindowWidth(now() + 2 * step);
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 4,
          height: 44,
          borderRadius: 2,
          background: "var(--ov-muted, #9aa4b2)",
          opacity: 0.6,
        }}
      />
    </div>
  );
}
