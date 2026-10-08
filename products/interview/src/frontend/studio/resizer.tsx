import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

const STEP = 16;

export type SizeLimits = {
  // Where the size is remembered between visits.
  storageKey: string;
  initial: number;
  min: number;
  // Read when used, since it usually depends on the window or a container.
  max: () => number;
};

function clamp(limits: SizeLimits, size: number) {
  return Math.round(
    Math.min(Math.max(limits.min, limits.max()), Math.max(limits.min, size)),
  );
}

// A size the person drags and the studio remembers.
export function useStoredSize(limits: SizeLimits) {
  const [size, setSize] = useState(() => {
    try {
      const value = Number(window.localStorage.getItem(limits.storageKey));
      return clamp(
        limits,
        Number.isFinite(value) && value > 0 ? value : limits.initial,
      );
    } catch {
      return clamp(limits, limits.initial);
    }
  });
  const latest = useRef(limits);
  latest.current = limits;
  const resize = useCallback((next: number) => {
    const value = clamp(latest.current, next);
    setSize(value);
    try {
      window.localStorage.setItem(latest.current.storageKey, String(value));
    } catch {
      // Storage is a convenience; the size still applies for this visit.
    }
  }, []);
  return { size, resize, limits };
}
export type StoredSize = ReturnType<typeof useStoredSize>;

// A drag handle between two areas. The size grows towards `grows`: dragging
// follows the pointer, arrows nudge, Home/End jump to the limits and a
// double-click restores the initial size.
export function Resizer({
  label,
  stored,
  grows,
  sizeFromPointer,
  className,
}: {
  label: string;
  stored: StoredSize;
  grows: "left" | "right" | "up";
  sizeFromPointer(event: PointerEvent): number;
  className: string;
}) {
  const { size, resize, limits } = stored;
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
  const [bigger, smaller] = (
    {
      left: ["ArrowLeft", "ArrowRight"],
      right: ["ArrowRight", "ArrowLeft"],
      up: ["ArrowUp", "ArrowDown"],
    } as const
  )[grows];
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable, focusable splitter with its own styling, which an hr cannot be
    <div
      role="separator"
      aria-label={label}
      aria-orientation={grows === "up" ? "horizontal" : "vertical"}
      aria-valuenow={size}
      aria-valuemin={limits.min}
      aria-valuemax={Math.max(limits.min, limits.max())}
      tabIndex={0}
      className={`${className}${active ? " active" : ""}`}
      title="Drag to resize · double-click to reset"
      onPointerDown={(event) => {
        dragging.current = true;
        setActive(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (dragging.current) resize(sizeFromPointer(event));
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        setActive(false);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onDoubleClick={() => resize(limits.initial)}
      onKeyDown={(event: KeyboardEvent) => {
        const next = {
          [bigger]: size + STEP,
          [smaller]: size - STEP,
          Home: limits.min,
          End: limits.max(),
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        resize(next);
      }}
    />
  );
}
