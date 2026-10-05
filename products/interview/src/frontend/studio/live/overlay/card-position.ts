// Where the overlay card sits when it floats over the Studio page. Pure
// clamping, plus a position kept for the session in memory (and
// sessionStorage, where the browser allows it). The PiP window and the
// chromeless route do not use this: their window is the drag surface.
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type CardPosition = { x: number; y: number };
type Box = { width: number; height: number };

const STORAGE_KEY = "interview-studio.live.card-position";
// The least of the card that must stay on screen below its top edge (its
// header, chips and toolbar), plus the page margin. The card's max-height is
// "viewport - top - 12px", so the rest of it scrolls inside, never off screen.
const MIN_VISIBLE_HEIGHT = 160;
const PAGE_MARGIN = 12;
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

// Keeps the card inside the viewport: all of its width, and at least its
// header row vertically, so it can always be grabbed again.
export function clampPosition(
  position: CardPosition,
  card: Box,
  viewport: Box,
): CardPosition {
  const maxX = Math.max(0, viewport.width - card.width);
  const maxY = Math.max(
    0,
    viewport.height - Math.min(card.height, MIN_VISIBLE_HEIGHT) - PAGE_MARGIN,
  );
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  };
}

let held: CardPosition | null = null;

function isPosition(value: unknown): value is CardPosition {
  const v = value as Partial<CardPosition> | null;
  return (
    typeof v?.x === "number" &&
    typeof v?.y === "number" &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y)
  );
}

export function readPosition(): CardPosition | null {
  if (held) return held;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isPosition(parsed)) held = parsed;
  } catch {
    // Storage is optional: the card then opens at its default corner.
  }
  return held;
}

function writePosition(position: CardPosition | null): void {
  held = position;
  try {
    if (position)
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Kept in memory only.
  }
}

// Tests: forget the remembered position.
export function resetPosition(): void {
  writePosition(null);
}

const sizeOf = (element: HTMLElement | null): Box => {
  const rect = element?.getBoundingClientRect();
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
};
const viewport = (): Box => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

// Drag by the header (pointer events) and move with the arrow keys from the
// handle. `null` means "not placed yet": the stylesheet puts the card at its
// default corner.
export function useCardDrag(
  cardRef: RefObject<HTMLElement | null>,
  // True once the card is in the document (it renders nothing without a session).
  present = true,
) {
  const [position, setPosition] = useState<CardPosition | null>(readPosition);
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const place = useCallback(
    (next: CardPosition) => {
      const clamped = clampPosition(next, sizeOf(cardRef.current), viewport());
      writePosition(clamped);
      setPosition(clamped);
    },
    [cardRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // Buttons, inputs and links in the header keep their own clicks.
      const target = event.target as HTMLElement;
      const handle = target.closest(".ov-handle");
      if (!handle && target.closest("button, input, a, [role=menu]")) return;
      // The handle is a button: pressing it must still focus it, for the
      // arrow-key alternative, though the drag swallows the default action.
      if (handle instanceof HTMLElement) handle.focus();
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      drag.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [cardRef],
  );
  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      place({
        x: event.clientX - active.offsetX,
        y: event.clientY - active.offsetY,
      });
    },
    [place],
  );
  const end = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
      const delta: Record<string, CardPosition> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      if (event.key === "Home") {
        event.preventDefault();
        writePosition(null);
        setPosition(null);
        return;
      }
      const move = delta[event.key];
      if (!move) return;
      event.preventDefault();
      const rect = cardRef.current?.getBoundingClientRect();
      const from = position ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 };
      place({ x: from.x + move.x, y: from.y + move.y });
    },
    [cardRef, position, place],
  );

  // A remembered position from a larger window or monitor is clamped as soon as
  // the card is on screen, before it paints there.
  useLayoutEffect(() => {
    if (present && position) place(position);
  }, [present]);

  // A smaller window pulls the card back on screen.
  useEffect(() => {
    const onResize = () => {
      if (position) place(position);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position, place]);

  return {
    position,
    header: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
    onHandleKeyDown,
  };
}
