// The one piece of state for "why the last capture did not work": set by every
// path that can fail a capture, cleared when the next capture succeeds or the
// person dismisses it. A surface draws it with CaptureProblemBanner and shows
// a toast where it has one; nothing is ever dropped silently.
import { useCallback, useMemo, useState } from "react";
import {
  canOpenExternalThroughHost,
  openExternalThroughHost,
} from "./host-adapter";
import {
  type CaptureProblem,
  type CaptureProblemReason,
  captureProblem,
  SCREEN_RECORDING_SETTINGS_URL,
} from "./shared/capture-problem";

export type CaptureProblemState = {
  reason: CaptureProblemReason;
  intent: "manual" | "auto";
  frontApp: string | null;
};

export function useCaptureProblem() {
  const [state, setState] = useState<CaptureProblemState | null>(null);
  const problem: CaptureProblem | null = useMemo(
    () =>
      state
        ? captureProblem(state.reason, {
            intent: state.intent,
            frontApp: state.frontApp,
          })
        : null,
    [state],
  );
  const show = useCallback((next: CaptureProblemState | null) => {
    setState((now) =>
      now === next ||
      (now &&
        next &&
        now.reason === next.reason &&
        now.intent === next.intent &&
        now.frontApp === next.frontApp)
        ? now
        : next,
    );
  }, []);
  const clear = useCallback(() => setState(null), []);
  // The problem's button, when this host can do it (otherwise the fix text stands).
  const onAction = useMemo(
    () =>
      canOpenExternalThroughHost()
        ? (id: NonNullable<CaptureProblem["action"]>["id"]) => {
            if (id === "open-screen-recording-settings")
              openExternalThroughHost(SCREEN_RECORDING_SETTINGS_URL);
          }
        : undefined,
    // The host bridge is injected before the page runs; read once per problem.
    [state],
  );
  return { state, problem, show, clear, onAction };
}
