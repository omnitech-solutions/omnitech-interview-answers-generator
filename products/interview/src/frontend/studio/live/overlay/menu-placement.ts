// Keeps a menu fully visible inside the card (which clips what overflows it):
// below its anchor when it fits, otherwise above when there is more room, with a
// maximum height so it scrolls inside, and shifted sideways to stay within the
// card. Pure placement, plus a layout effect that applies it.
import { type RefObject, useLayoutEffect } from "react";

export type Box = { left: number; top: number; right: number; bottom: number };
export type Placement = {
  side: "below" | "above";
  maxHeight: number;
  shiftX: number;
};

export const GAP = 4;
export const MARGIN = 8;
export const MIN_HEIGHT = 96;

export function placeMenu(input: {
  anchor: Box;
  bound: Box;
  menu: Box;
  // The menu's full height with nothing limiting it.
  height: number;
}): Placement {
  const { anchor, bound, menu, height } = input;
  const below = bound.bottom - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - bound.top - GAP - MARGIN;
  const side = height <= below || below >= above ? "below" : "above";
  const room = side === "below" ? below : above;
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(height, room));
  // Sideways only as far as the card's own edge.
  const low = bound.left;
  const high = bound.right;
  const shiftX =
    menu.right - menu.left > high - low
      ? low - menu.left
      : menu.left < low
        ? low - menu.left
        : menu.right > high
          ? high - menu.right
          : 0;
  return { side, maxHeight, shiftX };
}

const boxOf = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

// Applies placeMenu to an absolutely positioned menu while it is open, and again
// when the window changes size. Without layout (no offset parent) it does
// nothing, so the stylesheet's defaults stand.
export function useMenuPlacement(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => {
      const el = ref.current;
      const parent = el?.offsetParent as HTMLElement | null;
      if (!el || !parent) return;
      const view = el.ownerDocument.defaultView;
      const card = el.closest(".ov-card")?.getBoundingClientRect();
      const bound: Box = {
        left: Math.max(card?.left ?? 0, 0),
        top: Math.max(card?.top ?? 0, 0),
        right: Math.min(card?.right ?? Infinity, view?.innerWidth ?? Infinity),
        bottom: Math.min(
          card?.bottom ?? Infinity,
          view?.innerHeight ?? Infinity,
        ),
      };
      // Measure the menu as the stylesheet would draw it, unrestricted.
      el.style.maxHeight = "none";
      el.style.transform = "";
      const height = el.scrollHeight;
      const anchor = boxOf(parent.getBoundingClientRect());
      const result = placeMenu({
        anchor,
        bound,
        menu: boxOf(el.getBoundingClientRect()),
        height,
      });
      const offset = `${anchor.bottom - anchor.top + GAP}px`;
      el.style.maxHeight = `${result.maxHeight}px`;
      el.style.overflowY = "auto";
      el.style.top = result.side === "below" ? offset : "auto";
      el.style.bottom = result.side === "above" ? offset : "auto";
      el.style.transform = result.shiftX
        ? `translateX(${result.shiftX}px)`
        : "";
    };
    place();
    const view = ref.current?.ownerDocument.defaultView;
    view?.addEventListener("resize", place);
    return () => view?.removeEventListener("resize", place);
  }, [ref, active]);
}
