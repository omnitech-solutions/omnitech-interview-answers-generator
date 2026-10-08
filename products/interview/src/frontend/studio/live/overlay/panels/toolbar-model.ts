// What the toolbar's controls say, as data: the capture control's tone and menu
// sections, the microphone's look by state, the answer-style and shortcut menus
// and the chord glyphs. Pure: no React and no bridge, so each rule is a table
// test. The toolbar (toolbar.tsx and its toolbar-*.tsx parts) only draws this.

import type {
  ActionMenuSection,
  IconButtonTone,
} from "@oc-tech/omni-ui-components";
import { createElement } from "react";
import type { IconName } from "../../../icon";
import type { ScreenProblem } from "../../screen-problems";
import type { PickerRow } from "./display-picker-model";
import type { MicStatus } from "./mic-menu-model";
import {
  CAPTURE_MODES,
  type CaptureMode,
  captureMenuItems,
  shortcutGroups,
} from "./toolbar-config";

// What a locked control says while the session is paused (swap plan 4.2).
export const PAUSED_REASON = "Resume to capture";
// What a pane toggle says while the session is paused.
export const PAUSED_PANES_REASON = "Paused. Resume the session to see this.";
// What the one visible pane's toggle says: it cannot be turned off.
export const LAST_PANE_REASON = "At least one panel stays visible";

// ---- Chords as macOS glyphs ------------------------------------------------------

const GLYPHS: Record<string, string> = {
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Ctrl: "⌃",
  Control: "⌃",
  Cmd: "⌘",
  Meta: "⌘",
};

// "Alt+Shift+A" is "⌥⇧A"; a chord already written in glyphs ("⌘⇧S", "⌘,")
// stays as it is. The keys themselves are never retyped: they come from the
// shortcut tables.
export const chordGlyphs = (chord: string): string =>
  chord
    .split("+")
    .map((key) => GLYPHS[key] ?? key)
    .join("");

// ---- The capture control ----------------------------------------------------------

// The tone of the whole split button: dim while it waits (paused, no session),
// amber for a screen problem, blue for Auto, neutral for Manual. While work runs
// the library's ring takes the blue tone itself.
export function captureTone(input: {
  waiting: boolean;
  problem: boolean;
  analysing: boolean;
  auto: boolean;
}): IconButtonTone | undefined {
  if (input.waiting) return "dim";
  if (input.problem) return "warning";
  if (input.analysing) return undefined;
  return input.auto ? "accent" : undefined;
}

// The persistent screen problems as the menu's leading notice: the first one's
// reason and its fix; any others are named under it.
export function screenNotice(
  problems: readonly ScreenProblem[],
  canFix: (problem: ScreenProblem) => boolean,
): {
  title: string;
  detail?: string;
  fix: ScreenProblem["fix"] | null;
} | null {
  const [first, ...rest] = problems;
  if (!first) return null;
  return {
    title: first.title,
    ...(rest.length > 0
      ? { detail: rest.map((p) => p.title).join(" · ") }
      : {}),
    fix: canFix(first) ? first.fix : null,
  };
}

type CaptureSectionInput = {
  mode: CaptureMode;
  auto: Parameters<typeof captureMenuItems>[0]["auto"];
  target: string | null;
  open: boolean;
  // Why the display rows and "Add screen" wait (paused), or null.
  waiting: string | null;
  // The display rows (null: the host cannot choose a screen), and the honest
  // line under them when the list is not a list of displays.
  displays: {
    rows: PickerRow[];
    notice: { text: string; help?: string } | null;
  } | null;
  chords: { auto: string };
};

export const DISPLAY_FOLLOW_ID = "follow";
export const displayRowId = (id: number): string => `display:${id}`;
export const displayIdOfRow = (rowId: string): number | null =>
  rowId === DISPLAY_FOLLOW_ID ? null : Number(rowId.slice("display:".length));

// The capture menu: "When to analyse" (Manual, then Auto), "Display" (only where
// the host can choose a screen) and the one action that adds the screen to the
// task on show.
const DISPLAY_THUMBNAIL = {
  width: 72,
  height: 45,
  objectFit: "cover",
  borderRadius: 5,
  border: "1px solid rgba(127,127,127,0.4)",
  flex: "none",
} as const;

export function captureSections(
  input: CaptureSectionInput,
): ActionMenuSection[] {
  const items = captureMenuItems({
    mode: input.mode,
    auto: input.auto,
    target: input.target,
    open: input.open,
  });
  const modeItems = [...CAPTURE_MODES]
    .sort((a, b) => Number(a.on) - Number(b.on))
    .flatMap((mode) => {
      const item = items.find((each) => each.id === mode.id);
      return item
        ? [
            {
              id: item.id,
              label: item.label,
              description: item.subtitle,
              ...(mode.on ? { shortcut: [input.chords.auto] } : {}),
            },
          ]
        : [];
    });
  const attach = items.find((item) => item.id === "attach");
  const reason = attach?.disabledReason ?? input.waiting;
  const sections: ActionMenuSection[] = [
    {
      id: "mode",
      label: "When to analyse",
      value: input.mode,
      items: modeItems,
    },
  ];
  if (input.displays) {
    const rows = input.displays.rows.map((row) => ({
      id: row.kind === "follow" ? DISPLAY_FOLLOW_ID : displayRowId(row.id),
      label: row.kind === "follow" ? row.label : row.name,
      description: row.kind === "follow" ? row.sub : row.position,
      checked: row.checked,
      // A small picture of what that display shows now: with three screens,
      // "2 of 3" alone does not say which one it is.
      ...(row.kind === "display" && row.thumbnailSrc
        ? {
            icon: createElement("img", {
              src: row.thumbnailSrc,
              alt: "",
              draggable: false,
              style: DISPLAY_THUMBNAIL,
              "data-testid": `pn-display-thumb-${row.id}`,
            }),
          }
        : {}),
      ...(input.waiting ? { disabledReason: input.waiting } : {}),
    }));
    const note = input.displays.notice;
    sections.push({
      id: "display",
      label: "Display",
      highlightChecked: false,
      items: [
        ...rows,
        ...(note
          ? [
              {
                id: "display-note",
                label: note.text,
                ...(note.help ? { description: note.help } : {}),
                disabled: true,
              },
            ]
          : []),
      ],
    });
  }
  if (attach)
    sections.push({
      id: "extra",
      items: [
        {
          id: "attach",
          label: attach.label,
          ...(reason
            ? { disabledReason: reason }
            : { description: attach.subtitle }),
        },
      ],
    });
  return sections;
}

// ---- The microphone -----------------------------------------------------------------

export type MicLook = {
  icon: IconName;
  tone: IconButtonTone | undefined;
  badge: { tone: "warning"; label: string; description: string } | null;
  // The state in words (the tooltip, before the key).
  say: string;
};

// Zoom's semantics: listening is neutral, muted is red and slashed, lost or
// retrying is an amber outline with a "!" badge. `name` is the control's own
// action name ("Stop microphone"); it is the tooltip while all is well.
export function micLook(input: {
  recording: boolean;
  status: MicStatus;
  attempt: number;
  name: string;
}): MicLook {
  if (input.status === "lost" || input.status === "retrying") {
    const say =
      input.status === "retrying" && input.attempt > 0
        ? `Microphone lost · Trying again · attempt ${input.attempt}`
        : "Microphone lost";
    return {
      icon: "mic",
      tone: "warning",
      badge: { tone: "warning", label: "!", description: say },
      say,
    };
  }
  return input.recording
    ? { icon: "mic", tone: undefined, badge: null, say: input.name }
    : { icon: "mic_off", tone: "danger", badge: null, say: input.name };
}

// ---- Answer style ----------------------------------------------------------------------

// The grouped answer-style menu: Technical and Conversation, one check column.
export function answerStyleSections(
  groups: {
    id: string;
    label: string;
    styles: { id: string; label: string; checked: boolean }[];
  }[],
): ActionMenuSection[] {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    labelStyle: "caps" as const,
    items: group.styles.map((style) => ({
      id: style.id,
      label: style.label,
      checked: style.checked,
    })),
  }));
}

// "Previous / next" with the app's real keys for the two commands.
export function answerStyleHint(): { label: string; keys: string[] } {
  const rows =
    shortcutGroups().find((group) => group.id === "answer-style")?.rows ?? [];
  const chord = (id: string) =>
    chordGlyphs(rows.find((row) => row.id === id)?.chord ?? "");
  return {
    label: "Previous / next",
    keys: [chord("skill.prev"), chord("skill.next")].filter(Boolean),
  };
}

// ---- Shortcuts --------------------------------------------------------------------------

// The shortcut list: groups Capture, Listening, View, Answer style, App with
// macOS glyphs, "Clear session memory" last and in the destructive colour.
export function shortcutSections(): ActionMenuSection[] {
  return shortcutGroups().map((group) => {
    const clear = group.rows.filter((row) => row.id === "session.clear");
    const rest = group.rows.filter((row) => row.id !== "session.clear");
    return {
      id: group.id,
      label: group.label,
      labelStyle: "caps" as const,
      items: [...rest, ...clear].map((row) => ({
        id: row.id,
        label: row.label,
        shortcut: [chordGlyphs(row.chord)],
        ...(row.id === "session.clear" ? { tone: "danger" as const } : {}),
      })),
    };
  });
}

// A tone as a spread: the library's optional props do not take `undefined`.
export const toneProp = (
  tone: IconButtonTone | undefined,
): { tone?: IconButtonTone } => (tone === undefined ? {} : { tone });
