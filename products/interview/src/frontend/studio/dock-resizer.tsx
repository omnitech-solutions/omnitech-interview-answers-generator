import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "interview-studio.assistant-width";
export const DEFAULT_DOCK_WIDTH = 400;
const MIN_DOCK_WIDTH = 320;
// The view beside the dock keeps at least this much room.
const MIN_MAIN_WIDTH = 480;
const STEP = 16;

const maxWidth = () =>
  Math.max(MIN_DOCK_WIDTH, window.innerWidth - MIN_MAIN_WIDTH);
const clamp = (width: number) =>
  Math.round(Math.min(maxWidth(), Math.max(MIN_DOCK_WIDTH, width)));

function stored() {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_DOCK_WIDTH;
  } catch {
    return DEFAULT_DOCK_WIDTH;
  }
}

// The assistant dock's width: the package takes a fixed layout.width, so the
// shell owns it and remembers the person's choice.
export function useDockWidth() {
  const [width, setWidth] = useState(() => clamp(stored()));
  const resize = useCallback((next: number) => {
    const value = clamp(next);
    setWidth(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Storage is a convenience; the width still applies for this visit.
    }
  }, []);
  return { width, resize };
}

// The drag handle on the dock's left edge. Pointer drags follow the cursor;
// arrows nudge, Home/End jump to the limits, double-click resets.
export function DockResizer({
  width,
  onResize,
}: {
  width: number;
  onResize(width: number): void;
}) {
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
  const fromPointer = (event: PointerEvent) =>
    onResize(window.innerWidth - event.clientX);

  return (
    <div
      role="separator"
      aria-label="Resize assistant"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_DOCK_WIDTH}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      className={`studio-dock-resizer${active ? " active" : ""}`}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        dragging.current = true;
        setActive(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (dragging.current) fromPointer(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        setActive(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onDoubleClick={() => onResize(DEFAULT_DOCK_WIDTH)}
      onKeyDown={(event: KeyboardEvent) => {
        const next = {
          ArrowLeft: width + STEP,
          ArrowRight: width - STEP,
          Home: MIN_DOCK_WIDTH,
          End: maxWidth(),
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onResize(next);
      }}
    />
  );
}
