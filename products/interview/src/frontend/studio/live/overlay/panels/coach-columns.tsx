// The widths of a coach layout's side columns. Each is resized by dragging the
// bar between it and the centre (or with the arrow keys), from nothing to as
// wide as the window allows while the centre keeps its floor; a double click
// on a bar puts that column back, and "Reset layout" puts everything back.
// The widths are kept for the next session.
import { useEffect, useRef, useState } from "react";
import { QUESTIONS_WIDTH, RIGHT_WIDTH } from "./chat-view-pref";

const KEY = "omnitech.interview.coach.columns";
const STEP = 24;
// What the centre (the call and the notes) always keeps.
export const CENTRE_FLOOR = 320;
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
        ? Number(kept[side])
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
    return Math.max(0, total - other - CENTRE_FLOOR - SPLITTER_WIDTH * 2);
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
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onResize(drag.current.width + sign * (event.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
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
