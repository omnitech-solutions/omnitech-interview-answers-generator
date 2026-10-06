// Pass-through, page side. In the native compact window the page tells the shell
// the rectangle of every surface it paints or lets the person use, and the window
// takes the mouse only there; whatever is not drawn (empty glass around the
// toolbar, the gap above the footer, clear glass) passes clicks to whatever is
// underneath (Chrome), and is never a place to drag the window from. The selector table below is the ONE list of such surfaces.
//
// [SAFETY] The toolbar is always in the table, so See-through can always be turned
// off with the mouse. `null` (see-through off, unmounted, page hidden) makes the
// whole window interactive, and while it is on the report is repeated so the shell
// can tell a silent page from a still one (it falls back to interactive).
import {
  HIT_REGION_LIMITS,
  type HitRegion,
  type PresentationHost,
} from "@omnitech/interview-contracts";
import { useEffect } from "react";
import { hasCapability } from "./presentation-host";

// Every painted or interactive surface. Measured wherever it is in the document
// (the image viewer is portalled to the body). Add a surface here and nothing else.
export const HIT_SELECTORS = [
  ".pn-pill", // the toolbar (and the empty-session pill)
  ".pn-strip", // the status strip
  ".pn-card", // a pane's card: chat, answer, code, settings, unavailable
  ".pn-codecard", // the code card inside the answer pane
  ".pn-single-foot", // the footer
  ".pn-single-confirm", // an inline confirmation
  ".pn-ended", // the ended card
  ".pn-mini-card", // the Mini player
  ".pn-mini-foot",
  ".pn-start-card", // the sign-in and start screens
  ".pn-start-toast", // their toast
  ".pn-menu", // every popover and menu
  ".ov-rev-menu", // the revisions popover
  ".pn-toast", // a toast
  ".pn-jump", // the jump-to-latest control
  ".ss-viewer-scrim", // the screenshot viewer, when open: covers the window
] as const;

// Reports follow changes after this pause, and repeat on this beat; the shell
// treats a report older than HitRegions.staleAfter (15 s) as none, so the beat is
// well inside it.
export const HIT_DEBOUNCE_MS = 50;
export const HIT_HEARTBEAT_MS = 5000;

type Rect = { x: number; y: number; width: number; height: number };

// The rectangles a report may carry: finite, positive, within the wire limits,
// duplicates dropped. More than `maxRects` are never dropped (a dropped surface
// would stop taking clicks): the overflow is folded into one rectangle that covers it.
export function boundRegions(rects: readonly Rect[]): HitRegion[] {
  const { maxRects, maxSide } = HIT_REGION_LIMITS;
  const seen = new Set<string>();
  const good: HitRegion[] = [];
  for (const rect of rects) {
    const x = Math.round(rect.x * 10) / 10;
    const y = Math.round(rect.y * 10) / 10;
    const width = Math.round(rect.width * 10) / 10;
    const height = Math.round(rect.height * 10) / 10;
    if (![x, y, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    const clamped = {
      x: Math.max(-maxSide, Math.min(maxSide, x)),
      y: Math.max(-maxSide, Math.min(maxSide, y)),
      width: Math.min(width, maxSide),
      height: Math.min(height, maxSide),
    };
    const key = `${clamped.x},${clamped.y},${clamped.width},${clamped.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    good.push(clamped);
  }
  if (good.length <= maxRects) return good;
  const head = good.slice(0, maxRects - 1);
  const tail = good.slice(maxRects - 1);
  const left = Math.min(...tail.map((r) => r.x));
  const top = Math.min(...tail.map((r) => r.y));
  const right = Math.max(...tail.map((r) => r.x + r.width));
  const bottom = Math.max(...tail.map((r) => r.y + r.height));
  return [
    ...head,
    {
      x: left,
      y: top,
      width: Math.min(right - left, maxSide),
      height: Math.min(bottom - top, maxSide),
    },
  ];
}

// What to send: nothing masked (`null`) unless See-through is on. [SAFETY] No
// surface found at all is a page that is not drawn (yet): `null` (the whole
// window takes the mouse), never an empty list that would pass every click.
export const regionsToSend = (
  seeThrough: boolean,
  rects: readonly Rect[],
): HitRegion[] | null => {
  if (!seeThrough) return null;
  const bounded = boundRegions(rects);
  return bounded.length === 0 ? null : bounded;
};

export const sameRegions = (
  a: readonly HitRegion[] | null,
  b: readonly HitRegion[] | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.length === b.length &&
    a.every(
      (r, i) =>
        r.x === b[i]?.x &&
        r.y === b[i]?.y &&
        r.width === b[i]?.width &&
        r.height === b[i]?.height,
    ));

// The rectangles of the surfaces in the document now, in window coordinates.
export const surfaceElements = (root: ParentNode = document): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(HIT_SELECTORS.join(",")),
];

export function measureSurfaces(root: ParentNode = document): Rect[] {
  const out: Rect[] = [];
  for (const element of surfaceElements(root)) {
    if (element.hidden) continue;
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0)
      out.push({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      });
  }
  return out;
}

// Whether this host can do pass-through at all.
export const canPassThrough = (host: PresentationHost): boolean =>
  hasCapability(host, "hit-regions") &&
  typeof host.setHitRegions === "function";

// Reports the surfaces to the shell while `active` (See-through on, in the one
// window), and `null` the moment it is not, the page is hidden or unmounted.
export function useHitRegions(host: PresentationHost, active: boolean): void {
  useEffect(() => {
    if (!active || !canPassThrough(host)) return;
    // The shell's drag probe reads which surfaces are drawn from here: one list.
    document.documentElement.setAttribute(
      "data-hit-surfaces",
      HIT_SELECTORS.join(","),
    );
    let last: HitRegion[] | null = null;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const send = (force: boolean) => {
      // A hidden page (the window was ordered out: the app went expanded) reports nothing, so
      // its heartbeat cannot keep touching the shell while another window has the keyboard.
      if (document.visibilityState === "hidden") return;
      const next = regionsToSend(true, measureSurfaces());
      if (!force && sameRegions(last, next)) return;
      last = next;
      void host.setHitRegions?.(next);
    };
    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(() => send(false), HIT_DEBOUNCE_MS);
    };
    send(true);
    const beat = setInterval(() => send(true), HIT_HEARTBEAT_MS);
    // Sizes change without any DOM change (the window being resized, fonts, a
    // thumbnail decoding inside a menu, a text change): every surface is
    // observed itself, and the observed set follows the DOM.
    const sizes =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(soon);
    const watched = new Set<Element>();
    const syncWatched = () => {
      if (!sizes) return;
      const now = new Set<Element>(surfaceElements());
      for (const element of [...watched])
        if (!now.has(element)) {
          sizes.unobserve(element);
          watched.delete(element);
        }
      for (const element of now)
        if (!watched.has(element)) {
          sizes.observe(element);
          watched.add(element);
        }
    };
    const changed = () => {
      syncWatched();
      soon();
    };
    const mutations =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(changed);
    mutations?.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
    window.addEventListener("resize", soon);
    sizes?.observe(document.documentElement);
    syncWatched();
    // An image that finishes loading changes its surface's height without a
    // DOM change (load does not bubble: capture it).
    document.addEventListener("load", soon, true);
    const release = () => void host.setHitRegions?.(null);
    window.addEventListener("pagehide", release);
    // Hidden releases the mask as pagehide does; shown again, the report resumes at once.
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(pending);
        last = null;
        release();
      } else {
        send(true);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      clearTimeout(pending);
      clearInterval(beat);
      document.removeEventListener("load", soon, true);
      mutations?.disconnect();
      sizes?.disconnect();
      window.removeEventListener("resize", soon);
      window.removeEventListener("pagehide", release);
      document.documentElement.removeAttribute("data-hit-surfaces");
      release();
    };
  }, [host, active]);
}
