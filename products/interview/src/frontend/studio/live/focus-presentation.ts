// How the open session is presented: Full (the dashboard tabs), the card (the
// compact overlay card floating over the page), maximized (the same card
// filling the page's content area) or floating (the card in a Document
// Picture-in-Picture window). Which task is pinned lives here, above any
// host, so every presentation agrees and a closed float forgets nothing. This
// holds layout only: it never touches the session, and pinning is
// presentation (no submit, no counts).
//
// The in-tab mode (full, card or maximized) is remembered for the browser
// session in sessionStorage, where the browser allows it.
import { useSyncExternalStore } from "react";

export type TabMode = "full" | "card" | "maximized";
export type PresentationMode = TabMode | "floating";
// closed: no float. opening: window requested. pip: the window is open.
// fallback: the API is absent or refused, so the card shows in the tab.
export type FloatState = "closed" | "opening" | "pip" | "fallback";

export type Presentation = {
  mode: PresentationMode;
  // The in-tab presentation that was showing before the float opened (or
  // before the card was maximized), so closing returns there.
  previousMode: TabMode;
  float: FloatState;
  // null follows the newest task; an id pins an earlier one.
  pinnedTaskId: string | null;
};

const STORAGE_KEY = "interview-studio.live.presentation";
const TAB_MODES: readonly string[] = ["full", "card", "maximized"];

const INITIAL: Presentation = {
  mode: "full",
  previousMode: "full",
  float: "closed",
  pinnedTaskId: null,
};

function remembered(): TabMode {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored && TAB_MODES.includes(stored)) return stored as TabMode;
  } catch {
    // Storage is optional.
  }
  return "full";
}
function remember(mode: PresentationMode) {
  if (mode === "floating") return;
  try {
    if (mode === "full") window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Kept in memory only.
  }
}

let state: Presentation | null = null;
const current = (): Presentation => {
  if (!state) {
    const mode = remembered();
    state = { ...INITIAL, mode };
  }
  return state;
};
const listeners = new Set<() => void>();

function update(patch: Partial<Presentation>) {
  const before = current();
  const next = { ...before, ...patch };
  if (
    next.mode === before.mode &&
    next.previousMode === before.previousMode &&
    next.float === before.float &&
    next.pinnedTaskId === before.pinnedTaskId
  )
    return;
  state = next;
  if (next.mode !== before.mode) remember(next.mode);
  for (const listener of [...listeners]) listener();
}

export const presentation = {
  get: (): Presentation => current(),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setMode(mode: PresentationMode) {
    const before = current();
    if (mode === before.mode) return;
    // Opening the float remembers the tab mode it left, so closing returns
    // there; any other change is a choice of tab mode and resets the memory.
    update(
      mode === "floating"
        ? { mode, previousMode: before.mode as TabMode }
        : { mode, previousMode: mode },
    );
  },
  setFloat: (float: FloatState) => update({ float }),
  pin: (taskId: string | null) => update({ pinnedTaskId: taskId }),
  // Layout back to Full with no float and no pin. Never a session command.
  reset() {
    const changed =
      state !== null && JSON.stringify(state) !== JSON.stringify(INITIAL);
    state = { ...INITIAL };
    remember("full");
    if (changed) for (const listener of [...listeners]) listener();
  },
  // The float went away by choice (or the card was closed): back to the tab
  // mode that was active before it opened. Layout only, and the pin is kept.
  closeFloat: () =>
    update({
      mode: current().mode === "floating" ? current().previousMode : "full",
      previousMode: "full",
      float: "closed",
    }),
};

export function usePresentation(): Presentation {
  return useSyncExternalStore(
    presentation.subscribe,
    presentation.get,
    presentation.get,
  );
}

// True when the card is what the tab shows over the dashboard: the card, the
// maximized card, or the float's in-tab fallback.
export const cardInTab = (value: Presentation): boolean =>
  value.mode === "card" ||
  value.mode === "maximized" ||
  (value.mode === "floating" && value.float === "fallback");

// "compact" or "maximized": the one card's size.
export const cardSize = (value: Presentation): "compact" | "maximized" =>
  value.mode === "maximized" ? "maximized" : "compact";
