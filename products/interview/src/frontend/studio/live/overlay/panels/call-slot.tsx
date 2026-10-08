// [DOMAIN] Room for the call window (or the captured screen, in a coding
// round), above the coach's notes. It paints nothing but its outline and is
// not one of the window's surfaces, so in the native window the call shows
// through it and takes its own clicks. The bar under it is dragged (or moved
// with the arrow keys) to make the room any height, from none to nearly the
// whole window; a double click folds it away and brings it back. The height
// is kept for the next session.
import { useRef, useState } from "react";
import { useLayoutReset } from "./coach-columns";

const KEY = "omnitech.interview.call-slot.height";
const DEFAULT_HEIGHT = 250;
const STEP = 24;
// What the notes beneath always keep.
const NOTES_FLOOR = 160;
const MUTED = "var(--ov-muted, #9aa4b2)";

const ceiling = () =>
  Math.max(
    0,
    (typeof window === "undefined" ? 800 : window.innerHeight) - NOTES_FLOOR,
  );
const bound = (height: number) =>
  Math.round(Math.min(Math.max(height, 0), ceiling()));
function saved(): number {
  try {
    const kept = window.localStorage.getItem(KEY);
    const height = kept === null ? Number.NaN : Number(kept);
    return Number.isFinite(height) && height >= 0 ? height : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

export function CallSlot() {
  const [height, setHeight] = useState(saved);
  const shown = bound(height);
  // The height to come back to after the slot was folded away.
  const before = useRef(shown > 0 ? shown : DEFAULT_HEIGHT);
  const resize = (next: number) => {
    const bounded = bound(next);
    if (bounded > 0) before.current = bounded;
    setHeight(bounded);
    try {
      window.localStorage.setItem(KEY, String(bounded));
    } catch {
      // The height still holds for this window.
    }
  };
  // "Reset layout" puts the room back to the height it opens with.
  useLayoutReset(() => resize(DEFAULT_HEIGHT));
  // Where the drag began: the pointer's height on screen and the slot's own.
  const drag = useRef<{ y: number; height: number } | null>(null);
  return (
    <>
      <div
        style={{
          flex: `0 0 ${shown}px`,
          minHeight: 0,
          boxSizing: "border-box",
          borderRadius: 12,
          border: shown > 0 ? "1.5px dashed rgba(255, 255, 255, 0.28)" : "none",
          pointerEvents: "none",
        }}
        role="img"
        aria-label="Room for the call window"
        data-testid="pn-call-slot"
      />
      {/* A slider, so the shell treats it as a control and never drags the
          window from it; a surface of its own, so it takes the mouse. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Height of the room for the call window"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={ceiling()}
        aria-valuenow={shown}
        title="Drag to resize the room for the call window. Double-click to fold it away."
        data-hit-surface=""
        data-testid="pn-call-slot-resize"
        style={{
          flex: "0 0 16px",
          display: "grid",
          placeItems: "center",
          cursor: "ns-resize",
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          drag.current = { y: event.clientY, height: shown };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          resize(drag.current.height + event.clientY - drag.current.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => resize(shown > 0 ? 0 : before.current)}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowDown"
              ? shown + STEP
              : event.key === "ArrowUp"
                ? shown - STEP
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? ceiling()
                    : null;
          if (next === null) return;
          event.preventDefault();
          resize(next);
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 4,
            borderRadius: 2,
            background: MUTED,
            opacity: 0.75,
          }}
        />
      </div>
    </>
  );
}
