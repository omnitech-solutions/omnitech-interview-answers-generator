// What the one window's controls are, as data. The toolbar, the pane toggles,
// the window's width and the footer buttons are all drawn from these tables, so
// adding a pane or a mode is one entry here and nothing else changes.
import type { IconName } from "../../../icon";

// ---- Capture modes ------------------------------------------------------------

export const CAPTURE_MODES = [
  {
    id: "auto",
    label: "Auto",
    title: "Analyses a new screen by itself while the analysis is showing",
  },
  {
    id: "manual",
    label: "Manual",
    title: "Only analyses when you press capture",
  },
] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number]["id"];
// An action in the same menu: capture the screen as more of the problem on show
// (scroll, then add the next part). It is not a mode and is never remembered.
export const ATTACH_ACTION = {
  id: "attach",
  label: "Add screen to this problem",
  title: "Capture this screen as more of the current problem, not a new one",
} as const;

export const DEFAULT_CAPTURE_MODE: CaptureMode = "auto";
export const isCaptureMode = (value: unknown): value is CaptureMode =>
  CAPTURE_MODES.some((mode) => mode.id === value);

// ---- Panes --------------------------------------------------------------------

// Order is left to right. `width` is what the pane needs in CSS px.
export const PANES = [
  { id: "chat", icon: "forum", label: "chat", width: 320 },
  { id: "analysis", icon: "article", label: "analysis", width: 480 },
  { id: "code", icon: "code", label: "code", width: 420 },
] as const satisfies readonly {
  id: string;
  icon: IconName;
  label: string;
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

// ---- The capture control ------------------------------------------------------

// One button, two meanings: capture, or (while work runs) stop it. It keeps its
// screen icon and turns red when it means stop.
export function captureControl(analysing: boolean): {
  label: string;
  title: string;
  stop: boolean;
} {
  return analysing
    ? {
        label: "Stop analysis",
        title:
          "Stop the analysis. Press again to capture the screen as a new task",
        stop: true,
      }
    : {
        label: "Capture screenshot",
        title: "Capture and analyze the screen",
        stop: false,
      };
}

// ---- Footer buttons -----------------------------------------------------------

export type FooterButtonId = "pause" | "resume" | "end" | "start";
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
}): FooterButton[] {
  const noun = input.wording === "session" ? " session" : "";
  if (input.ended)
    return input.canStart
      ? [
          {
            id: "start",
            label: input.starting ? "Starting…" : "Start a new session",
            title: "Start a new session",
            icon: "play_circle",
            tone: "go",
            disabled: input.starting,
          },
        ]
      : [];
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

// What the app says it is doing, by what it is actually doing. A coding problem
// that has been detected says "Solutioning" rather than the generic "Analyzing".
const CAPTURING = "Capturing the screen";
const ANALYZING = "Analyzing";
const PHASE_LABELS: Record<string, string> = {
  "reading-coding-task": "Reading the problem",
  drafting: "Drafting an answer",
  "coding-draft": "Solutioning",
  "agent-working": "Solutioning",
};

export function phaseLabel(
  phase: "capturing" | "analyzing" | null,
  activityKey: string,
): string | null {
  if (phase === null) return null;
  if (phase === "capturing") return CAPTURING;
  return PHASE_LABELS[activityKey] ?? ANALYZING;
}

// ---- Missing context ------------------------------------------------------------

// What the model says it could not see, in words for the person. The kinds are
// the contract's closed set.
export const MISSING_CONTEXT_LABEL: Record<string, string> = {
  constraints: "Constraints",
  examples: "Examples",
  signature: "Function signature",
  language: "Target language",
  "statement-cut-off": "The rest of the problem (it looks cut off)",
  other: "Something else",
};
