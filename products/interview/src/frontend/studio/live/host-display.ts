// Where the host last captured from, and whether the person pinned capture to a
// display (D32, D33). The shell owns the pin; this is the page's copy of what
// the shell last said, fed by four echoes only: a capture result, a screen
// watch change, a `setCaptureDisplay` answer and a `listDisplays` answer (which
// carries the pin, so a fresh page learns it on mount). Kept in memory;
// nothing here is stored, logged or sent anywhere.

import type {
  StudioHostCaptureResult,
  StudioHostDisplay,
  StudioHostDisplayId,
  StudioHostDisplaySelectResult,
} from "@omnitech/interview-contracts";
import { useSyncExternalStore } from "react";
import { noteScreenProblem } from "./screen-problems";

export type CaptureSource = {
  // The display of the last capture or watch change; null when the shell has
  // not said (a browser, an older shell).
  display: StudioHostDisplay | null;
  pinned: boolean;
  // The pinned display, when the shell has named it.
  pinnedId: StudioHostDisplayId | null;
  // A pin was dropped and the person has not been told yet.
  pinDropped: boolean;
};

export const INITIAL_SOURCE: CaptureSource = {
  display: null,
  pinned: false,
  pinnedId: null,
  pinDropped: false,
};

export type SourceEvent =
  | {
      kind: "capture";
      display?: StudioHostDisplay | undefined;
      pinned?: boolean | undefined;
      pinFallback?: "display-unavailable" | undefined;
    }
  | { kind: "watch"; display?: StudioHostDisplay | undefined }
  | {
      kind: "pin";
      // The pin the shell reports (null: following the browser), with its
      // display when the listing named it, and whether a saved pin was dropped.
      pinnedId: StudioHostDisplayId | null;
      display?: StudioHostDisplay | undefined;
      pinFallback?: "display-unavailable" | undefined;
    }
  | { kind: "select"; result: StudioHostDisplaySelectResult }
  | { kind: "told" };

// The state machine, pure. A fallback always unpins and raises `pinDropped`
// once; only `told` lowers it.
export function reduceSource(
  state: CaptureSource,
  event: SourceEvent,
): CaptureSource {
  switch (event.kind) {
    case "capture": {
      const dropped = event.pinFallback === "display-unavailable";
      const pinned = event.pinned === true && !dropped;
      return {
        display: event.display ?? state.display,
        pinned,
        pinnedId: pinned ? (event.display?.id ?? state.pinnedId) : null,
        pinDropped: state.pinDropped || dropped,
      };
    }
    case "watch":
      return event.display ? { ...state, display: event.display } : state;
    case "pin": {
      const dropped = event.pinFallback === "display-unavailable";
      const pinnedId = dropped ? null : event.pinnedId;
      return {
        display:
          pinnedId === null ? state.display : (event.display ?? state.display),
        pinned: pinnedId !== null,
        pinnedId,
        pinDropped: state.pinDropped || dropped,
      };
    }
    case "select":
      if (!event.result.ok)
        return { ...state, pinned: false, pinnedId: null, pinDropped: true };
      return event.result.pinned
        ? {
            display: event.result.display ?? state.display,
            pinned: true,
            pinnedId: event.result.display?.id ?? null,
            pinDropped: state.pinDropped,
          }
        : { ...state, pinned: false, pinnedId: null };
    case "told":
      return state.pinDropped ? { ...state, pinDropped: false } : state;
  }
}

let current = INITIAL_SOURCE;
const listeners = new Set<() => void>();

// What an echo from the shell means for the problems kept on show: a dropped
// pin or a refused selection raises the display problem; a chosen display
// ends it; a frame from a capture ends every problem a failed capture raised.
function noteProblemsFrom(event: SourceEvent): void {
  const dropped =
    (event.kind === "capture" || event.kind === "pin") &&
    event.pinFallback === "display-unavailable";
  if (dropped || (event.kind === "select" && !event.result.ok))
    noteScreenProblem({ kind: "problem", problem: "display-disconnected" });
  else if (event.kind === "select")
    noteScreenProblem({ kind: "display-chosen" });
  else if (event.kind === "capture") noteScreenProblem({ kind: "capture-ok" });
}

export function noteSource(event: SourceEvent): void {
  noteProblemsFrom(event);
  const next = reduceSource(current, event);
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export const noteCaptureResult = (result: StudioHostCaptureResult): void => {
  if (result.ok)
    noteSource({
      kind: "capture",
      display: result.display,
      pinned: result.pinned,
      pinFallback: result.pinFallback,
    });
};

export const captureSourceNow = (): CaptureSource => current;

export const resetCaptureSource = (): void => {
  current = INITIAL_SOURCE;
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useCaptureSource = (): CaptureSource =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => INITIAL_SOURCE,
  );
