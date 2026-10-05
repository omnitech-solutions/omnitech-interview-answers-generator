// The typed command set every page understands, however it is issued: by the
// in-page keymap, or by a hotkey the host registered system-wide. Pure: this
// file maps keys to commands and claims one run per physical press; the
// controller (use-panel-session) says what each command does.
import {
  LIVE_OWNER_SKILLS,
  type LiveOwnerSkill,
  type StudioHostHotkey,
} from "@omnitech/interview-contracts";

export const COMMANDS = [
  "auto.toggle",
  "capture.analyze",
  "solution.generate",
  "transcribe.toggle",
  "skill.next",
  "skill.prev",
  "session.clear",
  "chat.focus",
  "see-through.toggle",
] as const;
export type Command = (typeof COMMANDS)[number];

// The analysis asks the chat box to take focus (same document).
export const FOCUS_INPUT_EVENT = "pn-focus-input";

export type CommandKey = {
  command: Command;
  keys: string;
  code: string;
  shift: boolean;
  label: string;
};

// Alt combinations, so they are safe while typing; matched on the physical key
// (Alt changes the character on macOS). The first two are the card's own keys.
export const COMMAND_KEYS: readonly CommandKey[] = [
  {
    command: "capture.analyze",
    keys: "Alt+Shift+A",
    code: "KeyA",
    shift: true,
    label: "Capture & analyze",
  },
  {
    command: "transcribe.toggle",
    keys: "Alt+R",
    code: "KeyR",
    shift: false,
    label: "Microphone on or off",
  },
  {
    command: "auto.toggle",
    keys: "Alt+Shift+H",
    code: "KeyH",
    shift: true,
    label: "Auto (hands-free) on or off",
  },
  {
    command: "solution.generate",
    keys: "Alt+Shift+S",
    code: "KeyS",
    shift: true,
    label: "Generate the solution",
  },
  {
    command: "skill.next",
    keys: "Alt+]",
    code: "BracketRight",
    shift: false,
    label: "Next skill",
  },
  {
    command: "skill.prev",
    keys: "Alt+[",
    code: "BracketLeft",
    shift: false,
    label: "Previous skill",
  },
  {
    command: "session.clear",
    keys: "Alt+Shift+C",
    code: "KeyC",
    shift: true,
    label: "Clear session memory",
  },
  {
    command: "chat.focus",
    keys: "Alt+Shift+F",
    code: "KeyF",
    shift: true,
    label: "Focus the chat",
  },
  {
    command: "see-through.toggle",
    keys: "Alt+Shift+I",
    code: "KeyI",
    shift: true,
    label: "See-through on or off",
  },
];

type KeyLike = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  code: string;
  isComposing?: boolean;
};

// The command a key press is, or null. Never during an IME composition, never
// with Ctrl or Meta.
export function commandOf(event: KeyLike): Command | null {
  if (event.isComposing || !event.altKey || event.ctrlKey || event.metaKey)
    return null;
  return (
    COMMAND_KEYS.find(
      (each) => each.code === event.code && each.shift === event.shiftKey,
    )?.command ?? null
  );
}

// The command a host hotkey name asks for, or null for a name this page does
// not know. The dotted names are the commands themselves; "capture-analyze" is
// the original spelling.
export function commandOfHotkey(
  hotkey: StudioHostHotkey | string,
): Command | null {
  if (hotkey === "capture-analyze") return "capture.analyze";
  return COMMANDS.find((each) => each === hotkey) ?? null;
}

// The skill the window starts with (the video's bar reads DSA).
export const DEFAULT_SKILL: LiveOwnerSkill = "dsa";

// The next or previous skill of the nine, wrapping at the ends.
export function cycleSkill(
  current: LiveOwnerSkill | undefined,
  step: 1 | -1,
): LiveOwnerSkill {
  const ring = LIVE_OWNER_SKILLS;
  const at = ring.indexOf(current ?? DEFAULT_SKILL);
  return ring[(at + step + ring.length) % ring.length] ?? DEFAULT_SKILL;
}

// One physical press is one run, however many documents hear it (a host hotkey
// reaches every page it hosts; the in-page key also fires). Granted once per
// window per command, here by timestamp and across same-origin windows by a Web
// Lock nobody else can take meanwhile.
const COMMAND_WINDOW_MS = 400;
const lastGranted = new Map<Command, number>();

export function resetCommandClaims(): void {
  lastGranted.clear();
}

export async function claimCommand(command: Command): Promise<boolean> {
  const now = Date.now();
  if (
    now - (lastGranted.get(command) ?? Number.NEGATIVE_INFINITY) <
    COMMAND_WINDOW_MS
  )
    return false;
  lastGranted.set(command, now);
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { locks?: LockManager }).locks;
  if (!locks) return true;
  try {
    return await new Promise<boolean>((resolve) => {
      void locks
        .request(
          `interview-studio.command.${command}`,
          { ifAvailable: true },
          (lock) => {
            resolve(lock !== null);
            return lock
              ? new Promise<void>((release) =>
                  setTimeout(release, COMMAND_WINDOW_MS),
                )
              : undefined;
          },
        )
        .catch(() => resolve(true));
    });
  } catch {
    return true;
  }
}
