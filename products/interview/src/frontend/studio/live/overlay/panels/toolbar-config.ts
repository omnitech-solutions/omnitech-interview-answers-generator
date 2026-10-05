// What the one window's controls are, as data. The toolbar, the pane toggles,
// the window's width and the footer buttons are all drawn from these tables, so
// adding a pane or a mode is one entry here and nothing else changes.
import type { IconName } from "../../../icon";
import { nativeChord } from "../../shared/shortcuts";
import { AUTO_MAX_PER_SESSION } from "../auto-gate";

// ---- Capture modes ------------------------------------------------------------

// What Auto does is limited by the Auto config; the menu says so with its real
// numbers.
type AutoLimits = { intervalSec: number; maxPerSession: number };
export const autoLimits = (intervalSec: number): AutoLimits => ({
  intervalSec,
  maxPerSession: AUTO_MAX_PER_SESSION,
});

// Auto and Manual are the two values of the ONE Auto preference (listening and
// watching the screen), on every surface: the toolbar menu, the strip, the Auto
// hotkey and the web band all read and write it. `on` is that preference.
export const CAPTURE_MODES = [
  {
    id: "auto",
    label: "Auto",
    on: true,
    title: "Listen, and capture when the screen changes",
    subtitle: (auto: AutoLimits) =>
      `Re-analyse when the screen changes · checks every ${auto.intervalSec} s, at most ${auto.maxPerSession} per session`,
  },
  {
    id: "manual",
    label: "Manual",
    on: false,
    title: "Capture only when you press Analyze",
    subtitle: () => `Analyse only when you press ${nativeChord("analyze")}`,
  },
] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number]["id"];

export const captureModeOf = (
  autoOn: boolean,
): (typeof CAPTURE_MODES)[number] =>
  CAPTURE_MODES.find((mode) => mode.on === autoOn) ?? CAPTURE_MODES[0];

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

// ---- Window controls and sizes ----------------------------------------------------

// The three always-coloured dots at the toolbar's left, as the Mac draws its
// window controls but glass-transparent. Yellow hides the window (pausing the
// session first when it is capturing or listening); the show/hide chord, the
// menu-bar item and the Dock icon bring it back. Red quits the app after a
// confirmation. Green toggles full screen on a click and opens the window-size
// menu (WINDOW_MODES) when the pointer rests on it. The hex values live in
// panels.css by `colour`.
export const WINDOW_CONTROLS = [
  {
    id: "quit",
    label: "Quit Interview Studio",
    title:
      "Quit the app. Your session stays on the server; capture and listening stop here",
    colour: "red",
    glyph: "×",
    action: "quit",
  },
  {
    id: "hide",
    label: "Hide window",
    title: `Hide the window. A live session pauses first · ${nativeChord("show-hide")}, the menu-bar item or the Dock icon shows it again`,
    colour: "yellow",
    glyph: "−",
    action: "hide",
  },
  {
    id: "size",
    label: "Full screen: click. Hold the pointer here for more window sizes",
    title:
      "Click for full screen. Hold the pointer here for Normal, Mini player and Full screen",
    colour: "green",
    glyph: "+",
    action: "size",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  title: string;
  colour: "red" | "yellow" | "green";
  glyph: string;
  action: "quit" | "hide" | "size";
}[];
export type WindowControlAction = (typeof WINDOW_CONTROLS)[number]["action"];

// How long the pointer rests on the green dot before its menu opens, and how
// long the menu waits after the pointer leaves the dot and the menu.
export const GREEN_MENU_HOVER_MS = 1000;
export const GREEN_MENU_GRACE_MS = 300;

export const QUIT_CONFIRMATION = {
  question: "Quit Interview Studio?",
  detail: "Your session stays on the server; capture and listening stop here.",
  cancel: "Cancel",
  confirm: "Quit",
} as const;

export const HIDDEN_TOAST = "Paused while hidden";

// The one window's sizes. `size` is the page's request to the shell: fit the
// panes that show, a fixed card (with the height it takes while a menu is
// open), or fill the display. `view` picks what is drawn; `needs` is the bridge
// method the host must offer.
export const MINI_SIZE = { width: 440, height: 190, menuHeight: 330 } as const;
export const WINDOW_MODES = [
  {
    id: "normal",
    label: "Normal",
    hint: "The toolbar with the chat, answer and code panes",
    size: { kind: "fit-panes" },
    view: "panel",
    needs: null,
  },
  {
    id: "mini",
    label: "Mini player",
    hint: "A small always-on-top card with the essentials",
    size: { kind: "fixed", ...MINI_SIZE },
    view: "mini",
    needs: "setWindowSize",
  },
  {
    id: "full",
    label: "Full screen",
    hint: `Fill this display with every pane · Esc leaves`,
    size: { kind: "fill-display" },
    view: "panel",
    needs: "setFullScreen",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  hint: string;
  size:
    | { kind: "fit-panes" }
    | { kind: "fixed"; width: number; height: number; menuHeight: number }
    | { kind: "fill-display" };
  view: "panel" | "mini";
  needs: "setWindowSize" | "setFullScreen" | null;
}[];
export type WindowModeId = (typeof WINDOW_MODES)[number]["id"];

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

// ---- The See-through control ------------------------------------------------------

// ONE switch for everything that lets the page underneath show and work: ON makes
// the glass behind the panes, strip, toolbar and footer clear (panels.css, keyed
// on data-glass="clear" on the panel root) AND, where the shell can (the
// "hit-regions" capability), passes the mouse to the app underneath wherever the
// window is empty glass; every painted surface keeps taking clicks (hit-regions.ts).
// OFF is the normal glass and the whole window takes the mouse. Text keeps its
// floor of tint and shadow, and the window, its dots and the footer stay visible.
export const SEE_THROUGH_CONTROL = {
  label: "See-through",
  icon: "contrast",
} as const satisfies { label: string; icon: IconName };

// The tooltip says exactly what is on, and what pressing it does.
export function seeThroughTitle(on: boolean, passThrough: boolean): string {
  const chord = nativeChord("see-through");
  const hotkey = passThrough ? ` · ${chord}` : "";
  if (on)
    return passThrough
      ? `See-through is on: the background is clear and clicks on empty glass reach the page underneath. Toolbar, panes and menus still take clicks. Press to turn off${hotkey}`
      : `See-through is on: the background is clear and text stays readable. Press to turn off`;
  return passThrough
    ? `See-through is off. Press to make the background clear, and let clicks on empty glass reach the page underneath${hotkey}`
    : "See-through is off. Press to make the background clear. Text stays readable";
}

// ---- The screen picker -----------------------------------------------------------

// The chevron attached to the capture button, shown only when the host
// advertises "display-selection" (the native panel). Its menu's first row follows
// the browser; the rest pin capture to one display. The chevron's name and the
// capture button's tooltip add the current choice (display-picker-model.ts).
export const SCREEN_CONTROL = {
  label: "Screen to capture",
  followLabel: "Follow my browser",
  followSub: "Capture the display your browser is on",
} as const satisfies {
  label: string;
  followLabel: string;
  followSub: string;
};

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

// What the bottom bar is for: a running (or paused) session, or a finished one.
export type FooterState =
  | { kind: "live"; paused: boolean; busy: boolean }
  // A finished session offers a new one, and its summary page when it can be
  // opened from here.
  | { kind: "ended"; starting: boolean; canSummary: boolean };

// Which buttons the bottom bar shows now. Pause is a break (the session stays
// open); End finishes it for good; a finished session offers a new one.
// "session" wording spells out what each button acts on: "Pause session".
export function footerButtons(
  state: FooterState,
  wording: "short" | "session",
): FooterButton[] {
  const noun = wording === "session" ? " session" : "";
  if (state.kind === "ended")
    return [
      ...(state.canSummary
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
      {
        id: "start" as const,
        label: state.starting ? "Starting…" : "Start a new session",
        title: "Start a new session",
        icon: "play_circle" as const,
        tone: "go" as const,
        disabled: state.starting,
      },
    ];
  return [
    state.paused
      ? {
          id: "resume",
          label: `Resume${noun}`,
          title: "Carry on listening and analysing",
          icon: "play_arrow",
          tone: "go",
          disabled: state.busy,
        }
      : {
          id: "pause",
          label: `Pause${noun}`,
          title:
            "Take a break: stop listening and analysing until you resume. The session stays open",
          icon: "pause",
          tone: "default",
          disabled: state.busy,
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
