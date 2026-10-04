// Shortcuts while the card has focus. Each is an Alt combination, so they are
// safe to use while typing in an input; nothing else is bound. They match on the
// physical key (`code`) because Alt changes the character on macOS.
import type { KeyboardEvent } from "react";

export type ShortcutId = "analyze" | "dictate" | "mask" | "settings";

export const SHORTCUTS: readonly {
  id: ShortcutId;
  keys: string;
  code: string;
  shift: boolean;
  label: string;
}[] = [
  {
    id: "analyze",
    keys: "Alt+Shift+A",
    code: "KeyA",
    shift: true,
    label: "Capture & analyze",
  },
  {
    id: "dictate",
    keys: "Alt+R",
    code: "KeyR",
    shift: false,
    label: "Dictation on or off",
  },
  {
    id: "mask",
    keys: "Alt+M",
    code: "KeyM",
    shift: false,
    label: "Capture region",
  },
  {
    id: "settings",
    keys: "Alt+,",
    code: "Comma",
    shift: false,
    label: "Settings",
  },
];

export const shortcutKeys = (id: ShortcutId): string =>
  SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? "";

// The shortcut an event is, or null. Never during an IME composition, and never
// with Ctrl or Meta.
export function shortcutOf(event: KeyboardEvent): ShortcutId | null {
  if (event.nativeEvent.isComposing || !event.altKey) return null;
  if (event.ctrlKey || event.metaKey) return null;
  return (
    SHORTCUTS.find(
      (shortcut) =>
        shortcut.code === event.code && shortcut.shift === event.shiftKey,
    )?.id ?? null
  );
}
