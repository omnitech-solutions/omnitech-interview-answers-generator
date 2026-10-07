// The screen problems the toolbar keeps on show until they are resolved
// (permission missing, the chosen display gone, the last capture failed), each
// with its fix action. The transient capture banner (use-capture-problem.ts)
// still says what just happened; this is the state that stays. A small
// external store like host-display.ts: in memory, nothing stored or sent.
//
// [SAFETY] Closed kinds and constant text only: never a window title, an
// address or captured content.
import { useSyncExternalStore } from "react";
import type { CaptureProblemReason } from "./shared/capture-problem";

export const SCREEN_PROBLEM_KINDS = [
  "permission-missing",
  "display-disconnected",
  "capture-failed",
] as const;
export type ScreenProblemKind = (typeof SCREEN_PROBLEM_KINDS)[number];

// What the fix button does: the surface wires it ("open-system-settings" opens
// Screen Recording settings through the host; "pick-display" opens the screen
// picker).
export type ScreenFixId = "open-system-settings" | "pick-display";

export type ScreenProblem = {
  kind: ScreenProblemKind;
  title: string;
  fix: { id: ScreenFixId; label: string };
};

export const SCREEN_PROBLEM_COPY: Record<ScreenProblemKind, ScreenProblem> = {
  "permission-missing": {
    kind: "permission-missing",
    title: "Screen Recording is off for Interview Studio",
    fix: { id: "open-system-settings", label: "Open System Settings" },
  },
  "display-disconnected": {
    kind: "display-disconnected",
    title: "The chosen display was disconnected",
    fix: { id: "pick-display", label: "Pick display" },
  },
  "capture-failed": {
    kind: "capture-failed",
    title: "The last capture failed",
    fix: { id: "pick-display", label: "Pick display" },
  },
};

// Which persistent problem a capture-problem reason becomes, or null for the
// reasons that are about the moment (busy, session paused, no browser in front)
// rather than the screen setup.
export function screenProblemKindOf(
  reason: CaptureProblemReason,
): ScreenProblemKind | null {
  switch (reason) {
    case "permission-denied":
      return "permission-missing";
    case "capture-failed":
    case "timeout":
      return "capture-failed";
    case "display-changed":
      return "display-disconnected";
    default:
      return null;
  }
}

export type ScreenProblemEvent =
  | { kind: "problem"; problem: ScreenProblemKind }
  // A capture came back with a frame: everything a failed capture raised is over.
  | { kind: "capture-ok" }
  // The person chose a display (or "follow my browser"): the display problem
  // and a failed capture are over; a missing permission is not.
  | { kind: "display-chosen" }
  // The displays were listed: the shell can read the screen again.
  | { kind: "permission-granted" };

// The state machine, pure. Order is the order of SCREEN_PROBLEM_KINDS, so the
// toolbar shows the same problem first however they arrived.
export function reduceScreenProblems(
  state: readonly ScreenProblemKind[],
  event: ScreenProblemEvent,
): readonly ScreenProblemKind[] {
  const keep = (drop: readonly ScreenProblemKind[]) =>
    state.filter((kind) => !drop.includes(kind));
  const next =
    event.kind === "problem"
      ? state.includes(event.problem)
        ? state
        : [...state, event.problem]
      : event.kind === "capture-ok"
        ? []
        : event.kind === "display-chosen"
          ? keep(["display-disconnected", "capture-failed"])
          : keep(["permission-missing"]);
  if (next === state) return state;
  const ordered = SCREEN_PROBLEM_KINDS.filter((kind) => next.includes(kind));
  return ordered.length === state.length &&
    ordered.every((kind, index) => kind === state[index])
    ? state
    : ordered;
}

export const screenProblemsOf = (
  kinds: readonly ScreenProblemKind[],
): ScreenProblem[] => kinds.map((kind) => SCREEN_PROBLEM_COPY[kind]);

let current: readonly ScreenProblemKind[] = [];
const listeners = new Set<() => void>();

export function noteScreenProblem(event: ScreenProblemEvent): void {
  const next = reduceScreenProblems(current, event);
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

// A capture problem reason from any capture path: raised when it is about the
// screen setup, ignored otherwise.
export function noteCaptureProblemReason(reason: CaptureProblemReason): void {
  const problem = screenProblemKindOf(reason);
  if (problem) noteScreenProblem({ kind: "problem", problem });
}

export const screenProblemKindsNow = (): readonly ScreenProblemKind[] =>
  current;

export const resetScreenProblems = (): void => {
  current = [];
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// The problems on show, oldest first (see reduceScreenProblems). A new array
// only when the set changes, so a render is stable between events.
let cache: { kinds: readonly ScreenProblemKind[]; list: ScreenProblem[] } = {
  kinds: [],
  list: [],
};
function listNow(): ScreenProblem[] {
  if (cache.kinds !== current)
    cache = { kinds: current, list: screenProblemsOf(current) };
  return cache.list;
}

export function useScreenProblems(): ScreenProblem[] {
  return useSyncExternalStore(subscribe, listNow, listNow);
}
