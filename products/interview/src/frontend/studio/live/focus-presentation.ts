// How the open session is presented: Full (the tabs), Focus (compact, in the
// tab) or floating (a Document Picture-in-Picture window). Which task is
// pinned lives here, above any portal, so the in-tab view and the float agree
// and a closed float forgets nothing. This holds layout only: it never
// touches the session, and pinning is presentation (no submit, no counts).
import { useSyncExternalStore } from "react";

export type PresentationMode = "full" | "focus" | "floating";
// closed: no float. opening: window requested. pip: the window is open.
// fallback: the API is absent or refused, so Focus shows in the tab.
export type FloatState = "closed" | "opening" | "pip" | "fallback";

export type Presentation = {
  mode: PresentationMode;
  float: FloatState;
  // null follows the newest task; an id pins an earlier one.
  pinnedTaskId: string | null;
};

const INITIAL: Presentation = {
  mode: "full",
  float: "closed",
  pinnedTaskId: null,
};
let state: Presentation = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<Presentation>) {
  const next = { ...state, ...patch };
  if (
    next.mode === state.mode &&
    next.float === state.float &&
    next.pinnedTaskId === state.pinnedTaskId
  )
    return;
  state = next;
  for (const listener of [...listeners]) listener();
}

export const presentation = {
  get: (): Presentation => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setMode: (mode: PresentationMode) => update({ mode }),
  setFloat: (float: FloatState) => update({ float }),
  pin: (taskId: string | null) => update({ pinnedTaskId: taskId }),
  // Layout back to Full with no float and no pin. Never a session command.
  reset: () => update(INITIAL),
  // The float went away by choice: layout only, and the pin is kept.
  closeFloat: () => update({ mode: "full", float: "closed" }),
};

export function usePresentation(): Presentation {
  return useSyncExternalStore(
    presentation.subscribe,
    presentation.get,
    presentation.get,
  );
}

// True when Focus is what the tab shows.
export const focusInTab = (value: Presentation): boolean =>
  value.mode === "focus" ||
  (value.mode === "floating" && value.float === "fallback");
