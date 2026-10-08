// The sizes a coach layout keeps: its columns and the room for the call (the
// library's Splitter draws and resizes them; this is only where they are
// remembered), and the window's own width and height, which the Splitters'
// outer edges ask for.
// "Reset layout" puts all of it back.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const KEY = "omnitech.interview.coach.sizes";
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

// The narrowest the side columns go: still readable, never folded away.
export const QUESTIONS_FLOOR = 180;
export const SIDE_FLOOR = 300;

// The layouts offered from the notes pane's Layout menu, as data.
export const COACH_LAYOUTS = [
  {
    id: "default",
    label: "Default",
    description:
      "Every column, the call's room and the window at their own sizes",
  },
  {
    id: "fill",
    label: "Fill the screen",
    description: "The window takes the whole screen",
  },
  {
    id: "notes",
    label: "Widest notes",
    description:
      "The questions and the answer at their narrowest, no room for the call",
  },
  {
    id: "no-call",
    label: "No room for the call",
    description: "The notes take the height of the centre column",
  },
] as const;
export type CoachLayoutId = (typeof COACH_LAYOUTS)[number]["id"];
const LAYOUT_SIZES: Record<
  Exclude<CoachLayoutId, "default" | "fill">,
  Sizes
> = {
  notes: { questions: QUESTIONS_FLOOR, side: SIDE_FLOOR, call: 0 },
  "no-call": { call: 0 },
};

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
  // [DOMAIN] A named layout: the default, or sizes set in one go. The window
  // fills the screen by asking for all of it; the call's room is folded away by
  // giving it none (its handle stays, to bring it back).
  const arrange = useCallback(
    (layout: CoachLayoutId) => {
      if (layout === "default") return reset();
      if (layout === "fill") {
        setCoachWindowWidth(window.screen.availWidth);
        setCoachWindowHeight(window.screen.availHeight);
        return;
      }
      keep(LAYOUT_SIZES[layout]);
    },
    [keep, reset],
  );
  return { sizes, keep, reset, resetKey, arrange };
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

// ---- How large the notes read ----------------------------------------------------

// [DOMAIN] The size of the coach's notes, chosen in the notes pane and kept:
// the library's CueCard scales as one. Large by default, since the notes are
// read at a glance during a call.
export const TEXT_SIZES = ["sm", "md", "lg", "xl"] as const;
export type CoachTextSize = (typeof TEXT_SIZES)[number];
const TEXT_KEY = "omnitech.interview.coach.text-size";
const TEXT_DEFAULT: CoachTextSize = "lg";
const textListeners = new Set<() => void>();
let textSize: CoachTextSize | undefined;
const isTextSize = (value: unknown): value is CoachTextSize =>
  TEXT_SIZES.some((size) => size === value);
export function setCoachTextSize(size: CoachTextSize): void {
  textSize = size;
  try {
    window.localStorage.setItem(TEXT_KEY, size);
  } catch {
    // The size still holds for this window.
  }
  for (const listener of textListeners) listener();
}
export function useCoachTextSize(): CoachTextSize {
  return useSyncExternalStore(
    (listener) => {
      textListeners.add(listener);
      return () => textListeners.delete(listener);
    },
    () => {
      if (textSize === undefined) {
        let kept: unknown = null;
        try {
          kept = window.localStorage.getItem(TEXT_KEY);
        } catch {
          // Nothing was kept.
        }
        textSize = isTextSize(kept) ? kept : TEXT_DEFAULT;
      }
      return textSize;
    },
    () => TEXT_DEFAULT,
  );
}

// ---- The centre column and the toolbar -------------------------------------------

// [DOMAIN] The centre column (the call's room over the notes) is as wide as
// the toolbar above it by default, and never narrower. The toolbar grows with
// its labels, so its width is measured, not assumed.
export const TOOLBAR_FALLBACK = 560;
// The Splitter's handles in a row of three columns: one per side column and
// one at each outer edge, 8px each.
export const COLUMN_HANDLES = 32;
export function useToolbarWidth(): number {
  const [width, setWidth] = useState(TOOLBAR_FALLBACK);
  useLayoutEffect(() => {
    const pill = document.querySelector<HTMLElement>(".pn-toolbar");
    if (!pill) return;
    const read = () => setWidth(pill.offsetWidth || TOOLBAR_FALLBACK);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(pill);
    return () => watch.disconnect();
  }, []);
  return width;
}
