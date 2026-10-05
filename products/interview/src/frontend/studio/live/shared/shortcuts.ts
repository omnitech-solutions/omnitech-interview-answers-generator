// Every shortcut the app really binds, in one table for the keys popover and
// the web hints. Native chords are registered by the Mac shell (Hotkeys.swift,
// which stays its own table); shortcuts.test.ts reads that file and fails when
// the two disagree. The web's own Alt bindings come from COMMAND_KEYS, the
// table the page's key handler already matches against.
import { COMMAND_KEYS, type Command } from "../overlay/panels/commands";

export type NativeShortcutId =
  | "analyze"
  | "listening"
  | "see-through"
  | "show-hide"
  | "focus-chat"
  | "clear-session"
  | "skill-previous"
  | "skill-next"
  | "auto"
  | "settings";

export type Shortcut = {
  id: NativeShortcutId | Command;
  label: string;
  chord: string;
  platform: "native" | "web";
  // The typed command the key asks the page for, when it is one.
  intent?: Command;
  // The shell registers this chord only while its whole-window interaction state
  // is on (Hotkeys.swift `requiresInteractive`), which is always now.
  requiresInteractive?: true;
};

// Keyed by id, so every id has exactly one entry and a typo cannot compile.
const NATIVE: Record<NativeShortcutId, Omit<Shortcut, "id" | "platform">> = {
  analyze: {
    label: "Analyze / stop",
    chord: "⌘⇧S",
    intent: "capture.analyze",
  },
  listening: {
    label: "Listening on or off",
    chord: "⌥R",
    intent: "transcribe.toggle",
  },
  "see-through": {
    label: "See-through on or off",
    chord: "⌘⇧I",
    intent: "see-through.toggle",
  },
  "show-hide": { label: "Show or hide", chord: "⌘⇧V" },
  "focus-chat": { label: "Focus chat", chord: "⌘⇧C", intent: "chat.focus" },
  "clear-session": {
    label: "Clear session memory",
    chord: "⌘⇧\\",
    intent: "session.clear",
  },
  "skill-previous": {
    label: "Previous answer style",
    chord: "⌘↑",
    intent: "skill.prev",
    requiresInteractive: true,
  },
  "skill-next": {
    label: "Next answer style",
    chord: "⌘↓",
    intent: "skill.next",
    requiresInteractive: true,
  },
  auto: { label: "Auto on or off", chord: "⌥⇧U", intent: "auto.toggle" },
  settings: { label: "Settings", chord: "⌘," },
};

// The chord the Mac shell registers for a control.
export const nativeChord = (id: NativeShortcutId): string => NATIVE[id].chord;

export const NATIVE_SHORTCUTS: readonly Shortcut[] = (
  Object.keys(NATIVE) as NativeShortcutId[]
).map((id) => ({ id, platform: "native", ...NATIVE[id] }));

export const WEB_SHORTCUTS: readonly Shortcut[] = COMMAND_KEYS.map((key) => ({
  id: key.command,
  label: key.label,
  chord: key.keys,
  platform: "web",
  intent: key.command,
}));

export const SHORTCUTS: readonly Shortcut[] = [
  ...NATIVE_SHORTCUTS,
  ...WEB_SHORTCUTS,
];

export const shortcutsFor = (platform: Shortcut["platform"]): Shortcut[] =>
  SHORTCUTS.filter((shortcut) => shortcut.platform === platform);
