// What the analysis and chat panels say, derived from the session's own
// published results and transcript. Pure; text from the session is inert.
import type {
  LiveAction,
  LiveCaptureSource,
  LiveObservation,
} from "@omnitech/interview-contracts";
import type { IconName } from "../../../icon";
import type { LiveViewModel } from "../../session-state";
import type { TaskView } from "../../session-tasks";
import { type TaskCard, taskCardModel } from "../../shared/task-card-model";
import { taskName } from "../../shared/task-name";
import { taskLabel, taskOrdinal } from "../../shared/task-target";
import { type ApproachItem, approach, type ChatEntry } from "../overlay-model";
import { phaseLabel } from "./toolbar-config";

// ---- Analysis ---------------------------------------------------------------

export type SectionName =
  | "Input"
  | "Output"
  | "Naive"
  | "Optimal"
  | "Complexity"
  | "Approach";
export type ApproachSection = { name: SectionName; lines: string[] };

const LEAD: [RegExp, SectionName][] = [
  [/^input\b[:\s-]*/i, "Input"],
  [/^output\b[:\s-]*/i, "Output"],
  [/^(naive|brute[- ]force)\b[:\s-]*/i, "Naive"],
  [/^(optimal|optimi[sz]ed|better)\b[:\s-]*/i, "Optimal"],
  [/^(time|space)?\s*complexity\b[:\s-]*/i, "Complexity"],
];
const ORDER: SectionName[] = [
  "Input",
  "Output",
  "Approach",
  "Naive",
  "Optimal",
  "Complexity",
];

// Groups the approach lines by what they say they are: a line that starts with
// "Naive", "Optimal", "Complexity", "Input" or "Output" opens that section; the
// rest are the approach. Nothing is invented: no line, no section.
export function approachSections(
  items: readonly ApproachItem[],
): ApproachSection[] {
  const found = new Map<SectionName, string[]>();
  const add = (name: SectionName, line: string) =>
    found.set(name, [...(found.get(name) ?? []), line]);
  for (const item of items) {
    if (item.kind === "code") continue;
    const lead = LEAD.find(([pattern]) => pattern.test(item.text));
    if (lead) add(lead[1], item.text.replace(lead[0], "").trim() || item.text);
    else if (/\bO\([^)]*\)/.test(item.text) && !found.has("Complexity"))
      add("Complexity", item.text);
    else add("Approach", item.text);
  }
  return ORDER.flatMap((name) => {
    const lines = found.get(name);
    return lines ? [{ name, lines }] : [];
  });
}

export const taskSections = (task: TaskView): ApproachSection[] => {
  const shown = approach(task);
  return shown ? approachSections(shown.items) : [];
};

// What the answer pane shows beyond the task card (its name, kind, constraints
// and code come from the shared card): the published answer's own sections and
// the worked example. A part the answer does not have is absent, never invented.
type AnswerStep = { heading: string; lines: string[] };
type AnswerView = {
  input: string[];
  output: string[];
  steps: AnswerStep[];
  complexity: string[];
  // A fenced block of the answer: the worked example, shown above the code.
  example: string | null;
};

const STEP_HEADING: Record<string, string> = {
  Approach: "Approach",
  Naive: "Naive Solution (Quick Start)",
  Optimal: "Optimal Solution",
};

export function answerView(task: TaskView): AnswerView {
  const sections = taskSections(task);
  const lines = (name: SectionName) =>
    sections.find((section) => section.name === name)?.lines ?? [];
  let number = 0;
  const steps = sections.flatMap((section) => {
    const label = STEP_HEADING[section.name];
    if (!label) return [];
    number += 1;
    return [{ heading: `${number}. ${label}`, lines: section.lines }];
  });
  return {
    input: lines("Input"),
    output: lines("Output"),
    steps,
    complexity: lines("Complexity"),
    example:
      approach(task)?.items.find((item) => item.kind === "code")?.text ?? null,
  };
}

// The suppression reason the server records when the owner stops work.
const OWNER_STOPPED_REASON = "owner_stopped";

// The task's runs were stopped by the owner (session-wide stop-work).
export const stoppedByYou = (task: TaskView): boolean =>
  task.current.runs.some((run) => run.reason === OWNER_STOPPED_REASON);

// What the code pane says while there is no code: one sentence per state of the
// task's code stage, never a promise the session has not made.
type CodePlaceholder = { text: string; busy: boolean };

export function codePlaceholder(input: {
  card: TaskCard | null;
  // The answer pane is showing the steps of a job: the approach is not drafted.
  approachPending: boolean;
  stoppedByYou: boolean;
  // Seconds the code has been in the writing (real, observed here).
  seconds: number;
}): CodePlaceholder {
  const { card } = input;
  if (!card)
    return {
      text: input.approachPending
        ? "Waits for the approach. Starts automatically."
        : "Code appears here after the approach is drafted.",
      busy: false,
    };
  if (input.approachPending)
    return {
      text: "Waits for the approach. Starts automatically.",
      busy: false,
    };
  const code = card.stages[1];
  switch (code.state) {
    case "unavailable":
      return {
        text: code.detail ?? "Code is not available for this task.",
        busy: false,
      };
    case "running":
      return {
        text: `Writing code…${input.seconds >= 3 ? ` ${input.seconds}s` : ""}`,
        busy: true,
      };
    case "stopped":
      return {
        text: input.stoppedByYou
          ? "Stopped before code was written."
          : (code.detail ?? "Stopped before code was written."),
        busy: false,
      };
    case "waiting":
      return {
        text:
          card.stages[0].state === "done"
            ? "No code yet."
            : "Waits for the approach. Starts automatically.",
        busy: false,
      };
    default:
      return { text: "The code is not available.", busy: false };
  }
}

// A chip per task: "T2 · Two Sum". Choosing one shows that task.
type TaskChip = {
  taskId: string;
  label: string;
  text: string;
  selected: boolean;
  newest: boolean;
};

export function taskChips(
  tasks: readonly TaskView[],
  selectedTaskId: string | undefined,
): TaskChip[] {
  return tasks.map((task, index) => {
    const label = taskLabel(taskOrdinal(tasks, task.taskId) ?? index + 1);
    return {
      taskId: task.taskId,
      label,
      text: `${label} · ${taskName(task)}`,
      selected: task.taskId === selectedTaskId,
      newest: index === tasks.length - 1,
    };
  });
}

// ---- Chat -------------------------------------------------------------------

// "heard" and "typed" are what was said; "assistant" is the reply to it;
// "marker" is a capture or stop between them.
export type PanelRowKind =
  | "heard"
  | "typed"
  | "assistant"
  | "system"
  | "marker";
type SpeakerId = "interviewer" | "you" | "typed" | "heard";
export type PanelRow = {
  key: string;
  kind: PanelRowKind;
  label: string;
  // Who said it, for heard and typed rows.
  speaker?: SpeakerId;
  text: string;
  at: number;
  icon?: IconName;
  // The assistant's formatted answer: its lines and fenced code blocks.
  items?: readonly ApproachItem[];
  // The task an assistant answer belongs to: choosing the row shows that task.
  taskId?: string;
  // What the task is doing right now. The row shows it in place of the answer
  // until the answer exists, then beside it until the work is done.
  stage?: TaskStage;
};

// Whose words a heard line is, from the capture source it arrived on and
// nothing else: the app's audio is the other side of the call, the microphone
// is you, anything else is only "Heard".
const SPEAKER: Record<
  Extract<LiveCaptureSource, "microphone" | "application-audio">,
  { speaker: SpeakerId; label: string }
> = {
  microphone: { speaker: "you", label: "You · mic" },
  "application-audio": {
    speaker: "interviewer",
    label: "Interviewer · app audio",
  },
};
const HEARD = { speaker: "heard", label: "Heard" } as const;
const TYPED = { speaker: "typed", label: "You · typed" } as const;

export const speakerOf = (
  source: LiveCaptureSource | null,
): { speaker: SpeakerId; label: string } =>
  source === "microphone" || source === "application-audio"
    ? SPEAKER[source]
    : HEARD;

// What the session's own observations and runs say happened, between the lines
// of the conversation: a task starting (with its screenshot, when the stream
// names one) and a task the owner stopped.
type TaskMarker = {
  key: string;
  at: number;
  icon: IconName;
  text: string;
};

export function taskMarkers(input: {
  tasks: readonly TaskView[];
  actions: readonly LiveAction[];
  observations: readonly LiveObservation[];
  deviceOnly: boolean;
}): TaskMarker[] {
  return input.tasks.flatMap((task) => {
    const card = taskCardModel({ ...input, selectedTaskId: task.taskId });
    if (!card) return [];
    const started: TaskMarker = {
      key: `m-start-${task.taskId}`,
      at: Date.parse(task.firstSeenAt) || 0,
      icon: card.snapshotLabel ? "screenshot_monitor" : "play_circle",
      text: card.snapshotLabel
        ? `${card.snapshotLabel} captured · ${card.label} started`
        : `${card.label} started`,
    };
    const stoppedAt = Math.max(
      ...task.current.runs
        .filter((run) => run.reason === OWNER_STOPPED_REASON)
        .map((run) => Date.parse(run.updatedAt) || 0),
      0,
    );
    return stoppedAt === 0
      ? [started]
      : [
          started,
          {
            key: `m-stop-${task.taskId}`,
            at: stoppedAt,
            icon: "stop_circle" as const,
            text: `${card.label} stopped by you · nothing published${
              task.answer ? " for code" : ""
            }`,
          },
        ];
  });
}

// A stage's label has no ellipsis; the row adds it and a timer.
export type TaskStage = { label: string; since: number };

// The stage a task is in, from its runs in flight: reading or drafting the
// answer, or (coding problem detected) solutioning.
export function taskStage(task: TaskView): TaskStage | null {
  const running = task.current.runs.filter((run) => run.state === "running");
  const coding = running.find(
    (run) =>
      run.actionKind === "solve-code" || run.actionKind === "agent-solve",
  );
  const drafting = running.find((run) => run.actionKind === "draft-answer");
  const run = coding ?? drafting;
  if (!run) return null;
  const key = coding
    ? "coding-draft"
    : task.kind === "programming-challenge"
      ? "reading-coding-task"
      : "drafting";
  return {
    label: phaseLabel("analyzing", key) ?? "Analyzing",
    since: Date.parse(run.createdAt) || Date.now(),
  };
}
export const PANEL_ROWS = 60;

// Heard speech (the server's transcript), what was typed or dictated here, and
// the assistant's published answers, oldest first.
export type SystemLine = { key: string; text: string; at: number };

export function panelRows(
  model: LiveViewModel,
  entries: readonly ChatEntry[],
  system: readonly SystemLine[] = [],
  // Rows at or before this time were cleared (session.clear).
  since = 0,
  markers: readonly TaskMarker[] = [],
): PanelRow[] {
  const heard: PanelRow[] = model.transcript.flatMap((row) =>
    row.type === "utterance" && !row.superseded
      ? [
          {
            key: `h-${row.sourceId}/${row.eventId}`,
            kind: "heard" as const,
            ...speakerOf(row.source),
            text: row.text,
            at: Date.parse(row.receivedAt),
          },
        ]
      : [],
  );
  const mine: PanelRow[] = entries
    .filter((entry) => entry.kind !== "Auto")
    .map((entry) => ({
      key: entry.key,
      kind: "typed" as const,
      ...TYPED,
      text: entry.text,
      at: entry.at,
    }));
  // One thread per task: the row is replaced in place as the task moves from
  // drafting to solutioning to its answer, and across its revisions.
  const assistant: PanelRow[] = model.tasks.flatMap((task) => {
    const shown = approach(task);
    const first = shown?.items.find((item) => item.kind === "line");
    const stage = taskStage(task);
    if (!(shown && first) && !stage) return [];
    const last = task.revisions[task.revisions.length - 1];
    return [
      {
        key: `a-${task.taskId}`,
        taskId: task.taskId,
        kind: "assistant" as const,
        label: `Studio · ${taskLabel(taskOrdinal(model.tasks, task.taskId) ?? 1)}`,
        text:
          shown && first ? shown.items.map((item) => item.text).join("\n") : "",
        ...(shown && first ? { items: shown.items } : {}),
        ...(stage ? { stage } : {}),
        at: Date.parse(last?.firstSeenAt ?? "") || 0,
      },
    ];
  });
  const lines: PanelRow[] = system.map((line) => ({
    key: line.key,
    kind: "system" as const,
    label: "System",
    text: line.text,
    at: line.at,
  }));
  const between: PanelRow[] = markers.map((marker) => ({
    key: marker.key,
    kind: "marker" as const,
    label: "",
    text: marker.text,
    icon: marker.icon,
    at: marker.at,
  }));
  return [...heard, ...mine, ...assistant, ...lines, ...between]
    .filter((row) => row.kind === "system" || row.at > since)
    .sort((a, b) => a.at - b.at)
    .slice(-PANEL_ROWS);
}

// The follow-up box says which task its text is about: the one on show.
export const followUpPlaceholder = (targetLabel: string | null): string =>
  targetLabel
    ? `Add context to ${targetLabel}, or ask a follow-up`
    : "Ask anything, or add context";

export const clock = (at: number): string =>
  Number.isNaN(at) || at === 0
    ? ""
    : new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
