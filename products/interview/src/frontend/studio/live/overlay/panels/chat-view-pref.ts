// How the transcript pane is laid out, chosen from its header and kept for the
// next session. The pane and the coach panel both read it: with a conversation
// view the coach's notes sit under their questions, so the separate coach
// panel is not drawn.
import { useSyncExternalStore } from "react";

export const CHAT_VIEWS = [
  {
    id: "conversation-slot",
    label: "Conversation under the call",
    hint: "Room for the call window on top, questions and notes beneath it",
  },
  {
    id: "conversation",
    label: "Conversation",
    hint: "Each question with its notes and answers beneath it",
  },
  {
    id: "transcript",
    label: "Transcript and prompter",
    hint: "Every line as it was heard, with the coach panel apart",
  },
] as const;
export type ChatView = (typeof CHAT_VIEWS)[number]["id"];

const KEY = "omnitech.interview.chat.view";
// The transcript with the coach panel apart is what a window opens with: the
// conversation layouts are chosen, until their design is settled.
const DEFAULT: ChatView = "transcript";
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

export const isConversation = (view: ChatView): boolean =>
  view !== "transcript";
export const hasCallSlot = (view: ChatView): boolean =>
  view === "conversation-slot";

// What the conversation pane needs beyond the transcript's own width: a call
// window is not usable much narrower than this.
export const CONVERSATION_WIDTH = 520;
