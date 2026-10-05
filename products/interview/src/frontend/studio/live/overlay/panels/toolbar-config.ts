// What the one window's controls are, as data. The toolbar, the pane toggles,
// the window's width and the footer buttons are all drawn from these tables, so
// adding a pane or a mode is one entry here and nothing else changes.
import type { IconName } from "../../../icon";
import { NATIVE_SHORTCUTS } from "../../shared/shortcuts";
import { AUTO_MAX_PER_SESSION } from "../auto-gate";

// The chord the Mac shell registers for a control, from the one shortcut table.
export const nativeChord = (id: string): string =>
  NATIVE_SHORTCUTS.find((shortcut) => shortcut.id === id)?.chord ?? "";

// ---- Capture modes ------------------------------------------------------------

// What Auto does is limited by the Auto config; the menu says so with its real
// numbers.
type AutoLimits = { intervalSec: number; maxPerSession: number };
export const autoLimits = (intervalSec: number): AutoLimits => ({
  intervalSec,
  maxPerSession: AUTO_MAX_PER_SESSION,
});

export const CAPTURE_MODES = [
  {
    id: "auto",
    label: "Auto",
    title: "Analyses a new screen by itself while the analysis is showing",
    subtitle: (auto: AutoLimits) =>
      `Re-analyse when the screen changes · checks every ${auto.intervalSec} s, at most ${auto.maxPerSession} per session`,
  },
  {
    id: "manual",
    label: "Manual",
    title: "Only analyses when you press capture",
    subtitle: () => `Analyse only when you press ${nativeChord("analyze")}`,
  },
] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number]["id"];

export const DEFAULT_CAPTURE_MODE: CaptureMode = "auto";
export const isCaptureMode = (value: unknown): value is CaptureMode =>
  CAPTURE_MODES.some((mode) => mode.id === value);

// One row of the capture menu: a mode (checked when chosen) or the action that
// captures the screen as more of the task on show. The action is never
// remembered; it is disabled, with its reason in the subtitle, until a task
// exists.
type CaptureMenuItem = {
  id: CaptureMode | "attach";
  label: string;
  subtitle: string;
  checked: boolean;
  disabledReason: string | null;
};

export function captureMenuItems(input: {
  mode: CaptureMode;
  auto: AutoLimits;
  // "T2": the task on show, or null when there is none.
  target: string | null;
  open: boolean;
}): CaptureMenuItem[] {
  const modes = CAPTURE_MODES.map((mode) => ({
    id: mode.id,
    label: mode.label,
    subtitle: mode.subtitle(input.auto),
    checked: mode.id === input.mode,
    disabledReason: null,
  }));
  const reason = !input.open
    ? "The session has ended"
    : input.target === null
      ? "Needs a task first"
      : null;
  return [
    ...modes,
    {
      id: "attach",
      label: `Add screen to ${input.target ?? "this problem"}`,
      subtitle: reason ?? "Adds the current screen as context to the same task",
      checked: false,
      disabledReason: reason,
    },
  ];
}

// ---- Panes --------------------------------------------------------------------

// Order is left to right. `width` is what the pane needs in CSS px.
export const PANES = [
  {
    id: "chat",
    icon: "forum",
    label: "Chat",
    title: `Conversation · ${nativeChord("focus-chat")}`,
    width: 320,
  },
  {
    id: "analysis",
    icon: "lightbulb",
    label: "Answer",
    title: "The answer for the task on show",
    width: 480,
  },
  {
    id: "code",
    icon: "code",
    label: "Code",
    title: "The code for the task on show",
    width: 420,
  },
] as const satisfies readonly {
  id: string;
  icon: IconName;
  label: string;
  title: string;
  width: number;
}[];
export type PaneId = (typeof PANES)[number]["id"];
export type PaneState = Record<PaneId, boolean>;
export const ALL_PANES_SHOWN: PaneState = {
  chat: true,
  analysis: true,
  code: true,
};

// The toolbar alone, until its real width is measured.
export const BARE_WIDTH = 540;
const GAP = 8;
const PAD = 16;

// The window is as wide as the panes that show, never narrower than `floor`.
export function windowWidthFor(shown: PaneState, floor = BARE_WIDTH): number {
  const widths = PANES.filter((pane) => shown[pane.id]).map(
    (pane) => pane.width,
  );
  const wanted =
    widths.length === 0
      ? 0
      : widths.reduce((sum, width) => sum + width, 0) +
        GAP * (widths.length - 1) +
        PAD;
  return Math.max(wanted, floor);
}
export const WINDOW_GAP = GAP;
export const WINDOW_PAD = PAD;
// A menu opened from the toolbar needs this much window below it, even when no
// pane is showing.
export const POPOVER_ROOM = 340;

// ---- The capture control ------------------------------------------------------

// One button, two meanings: capture, or (while work runs) stop it. It turns red
// when it means stop. Stop is session-wide: the server cancels every run in
// flight and the session stays open.
export function captureControl(analysing: boolean): {
  label: string;
  title: string;
  stop: boolean;
} {
  return analysing
    ? {
        label: "Stop",
        title:
          "Stop all analysis in this session. The session keeps running. Press again to capture the screen as a new task",
        stop: true,
      }
    : {
        label: "Analyze screen",
        title: "Capture the screen and analyse it as a new problem",
        stop: false,
      };
}

// ---- Footer buttons -----------------------------------------------------------

export type FooterButtonId = "pause" | "resume" | "end" | "start" | "summary";
export type FooterButton = {
  id: FooterButtonId;
  label: string;
  title: string;
  icon?: IconName;
  tone: "default" | "go" | "danger";
  disabled: boolean;
};

// Which buttons the bottom bar shows now. Pause is a break (the session stays
// open); End finishes it for good; a finished session offers a new one.
export function footerButtons(input: {
  paused: boolean;
  ended: boolean;
  starting: boolean;
  busy: boolean;
  // "session" spells out what each button acts on: "Pause session".
  wording: "short" | "session";
  canStart: boolean;
  // The ended session's summary page can be opened from here.
  canSummary?: boolean;
}): FooterButton[] {
  const noun = input.wording === "session" ? " session" : "";
  if (input.ended)
    return [
      ...(input.canSummary
        ? [
            {
              id: "summary" as const,
              label: "Open summary",
              title: "Open this session's summary in Studio",
              icon: "open_in_new" as const,
              tone: "default" as const,
              disabled: false,
            },
          ]
        : []),
      ...(input.canStart
        ? [
            {
              id: "start" as const,
              label: input.starting ? "Starting…" : "Start a new session",
              title: "Start a new session",
              icon: "play_circle" as const,
              tone: "go" as const,
              disabled: input.starting,
            },
          ]
        : []),
    ];
  return [
    input.paused
      ? {
          id: "resume",
          label: `Resume${noun}`,
          title: "Carry on listening and analysing",
          icon: "play_arrow",
          tone: "go",
          disabled: input.busy,
        }
      : {
          id: "pause",
          label: `Pause${noun}`,
          title:
            "Take a break: stop listening and analysing until you resume. The session stays open",
          icon: "pause",
          tone: "default",
          disabled: input.busy,
        },
    {
      id: "end",
      label: `End${noun}`,
      title: "Finish this session for good. You can start a new one afterwards",
      tone: "danger",
      disabled: false,
    },
  ];
}

// ---- Phases -------------------------------------------------------------------

// The steps an analysis goes through, in order, as the answer pane lists them.
const ANSWER_STEPS = [
  { id: "capturing", label: "Capturing the screen" },
  { id: "reading", label: "Reading the problem" },
  { id: "drafting", label: "Drafting an answer" },
] as const;
type AnswerStepId = (typeof ANSWER_STEPS)[number]["id"];

// What the app says it is doing, and the step that is, by what it is actually
// doing. A coding problem that has been detected says "Solutioning" rather than
// the generic "Analyzing".
const CAPTURING = { label: ANSWER_STEPS[0].label, step: "capturing" } as const;
const ANALYZING = { label: "Analyzing", step: "reading" } as const;
const PHASES: Record<string, { label: string; step: AnswerStepId }> = {
  "reading-coding-task": { label: ANSWER_STEPS[1].label, step: "reading" },
  drafting: { label: ANSWER_STEPS[2].label, step: "drafting" },
  "coding-draft": { label: "Solutioning", step: "drafting" },
  "agent-working": { label: "Solutioning", step: "drafting" },
};

function phaseOf(
  phase: "capturing" | "analyzing",
  activityKey: string,
): { label: string; step: AnswerStepId } {
  return phase === "capturing" ? CAPTURING : (PHASES[activityKey] ?? ANALYZING);
}

export function phaseLabel(
  phase: "capturing" | "analyzing" | null,
  activityKey: string,
): string | null {
  return phase === null ? null : phaseOf(phase, activityKey).label;
}

type StepState = "done" | "active" | "waiting";

// Every step with where the work is: the ones before the active step are done.
export function answerSteps(
  phase: "capturing" | "analyzing",
  activityKey: string,
): { id: AnswerStepId; label: string; state: StepState }[] {
  const at = ANSWER_STEPS.findIndex(
    (step) => step.id === phaseOf(phase, activityKey).step,
  );
  return ANSWER_STEPS.map((step, index) => ({
    ...step,
    state: index < at ? "done" : index === at ? "active" : "waiting",
  }));
}
