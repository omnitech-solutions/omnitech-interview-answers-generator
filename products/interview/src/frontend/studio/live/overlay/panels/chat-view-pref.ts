// How the live window is laid out, chosen from the toolbar's View menu and
// kept for the next session. "Original" is the base: the transcript, the
// answer and the code, with the coach panel docked at an edge. The coach
// layouts put the call at the top and the coach's notes directly beneath it.
import { useSyncExternalStore } from "react";

export const CHAT_VIEWS = [
  {
    id: "coach",
    group: "coach",
    label: "Call-first coach",
    hint: "Questions, coach, answer",
  },
  {
    id: "conversation",
    group: "coach",
    label: "Conversation under the call",
    hint: "Questions, notes, transcript",
  },
  {
    id: "prompter",
    group: "coach",
    label: "Prompter only",
    hint: "The call and one note",
  },
  {
    id: "original",
    group: "classic",
    label: "Original",
    hint: "Transcript, answer, code and the coach panel",
  },
  {
    id: "transcript",
    group: "classic",
    label: "Transcript only",
    hint: "For review or a record",
  },
] as const;
export type ChatView = (typeof CHAT_VIEWS)[number]["id"];
export const VIEW_GROUPS = [
  { id: "coach", label: "Coach" },
  { id: "classic", label: "Classic" },
] as const;

const KEY = "omnitech.interview.view";
// A window opens in the call-first coach layout until another is chosen; the
// base layout is "Original" in the View menu.
const DEFAULT: ChatView = "coach";
const isView = (value: string | null): value is ChatView =>
  CHAT_VIEWS.some((view) => view.id === value);

const listeners = new Set<() => void>();
function read(): ChatView {
  try {
    const kept = window.localStorage.getItem(KEY);
    return isView(kept) ? kept : DEFAULT;
  } catch {
    return DEFAULT;
  }
}
let current: ChatView | null = null;

export function setChatView(next: ChatView): void {
  current = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // The choice still holds for this window.
  }
  for (const listener of listeners) listener();
}

export function useChatView(): ChatView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      current ??= read();
      return current;
    },
    () => DEFAULT,
  );
}

// A coach layout draws the notes itself, so the docked coach panel stands down.
export const isCoachView = (view: ChatView): boolean =>
  view === "coach" || view === "conversation" || view === "prompter";

// What each coach layout asks of the window, in CSS px. The columns are
// QUESTIONS_WIDTH, the centre (never under 560) and RIGHT_WIDTH.
export const QUESTIONS_WIDTH = 250;
export const RIGHT_WIDTH = 400;
export const COACH_WINDOW = {
  coach: { width: 1340, height: 860 },
  conversation: { width: 1340, height: 860 },
  prompter: { width: 720, height: 780 },
} as const;
