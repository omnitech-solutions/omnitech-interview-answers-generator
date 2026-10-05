// Every shortcut the app really binds, in one table for the keys popover and
// the web hints. Native chords are registered by the Mac shell (Hotkeys.swift,
// which stays its own table); shortcuts.test.ts reads that file and fails when
// the two disagree. The web's own Alt bindings come from COMMAND_KEYS, the
// table the page's key handler already matches against.
import { COMMAND_KEYS } from "../overlay/panels/commands";

export type Shortcut = {
  id: string;
  label: string;
  chord: string;
  platform: "native" | "web";
  // The typed command the key asks the page for, when it is one.
  intent?: string;
};

export const NATIVE_SHORTCUTS: readonly Shortcut[] = [
  {
    id: "analyze",
    label: "Analyze / stop",
    chord: "⌘⇧S",
    platform: "native",
    intent: "capture.analyze",
  },
  {
    id: "listening",
    label: "Listening on or off",
    chord: "⌥R",
    platform: "native",
    intent: "transcribe.toggle",
  },
  {
    id: "click-through",
    label: "Click-through",
    chord: "⌘⇧I",
    platform: "native",
  },
  {
    id: "show-hide",
    label: "Show or hide",
    chord: "⌘⇧V",
    platform: "native",
  },
  {
    id: "focus-chat",
    label: "Focus chat",
    chord: "⌘⇧C",
    platform: "native",
    intent: "chat.focus",
  },
  {
    id: "clear-session",
    label: "Clear session memory",
    chord: "⌘⇧\\",
    platform: "native",
    intent: "session.clear",
  },
  {
    id: "skill-previous",
    label: "Previous answer style",
    chord: "⌘↑",
    platform: "native",
    intent: "skill.prev",
  },
  {
    id: "skill-next",
    label: "Next answer style",
    chord: "⌘↓",
    platform: "native",
    intent: "skill.next",
  },
  {
    id: "auto",
    label: "Auto on or off",
    chord: "⌥⇧U",
    platform: "native",
    intent: "auto.toggle",
  },
  { id: "settings", label: "Settings", chord: "⌘,", platform: "native" },
];

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
