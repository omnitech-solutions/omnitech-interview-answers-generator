// What the analysis and chat panels say, derived from the session's own
// published results and transcript. Pure; text from the session is inert.
import type { LiveViewModel } from "../../session-state";
import type {
  LiveAction,
  LiveMissingContext,
} from "@omnitech/interview-contracts";
import type { TaskView } from "../../session-tasks";
import { TASK_KIND } from "../../task-panels";
import {
  type ApproachItem,
  approach,
  type ChatEntry,
  solution,
} from "../overlay-model";
import { taskHeading } from "../overlay-task";
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

// What the analysis panel shows for the newest task: the text column (title,
// type, constraint chips, input/output, numbered approach) and the separate
// code card. Everything is the published answer's own text; a part the answer
// does not have is absent, never invented.
export type AnalysisStep = { heading: string; lines: string[] };
export type AnalysisView = {
  title: string;
  problemType: string;
  constraints: string[];
  input: string[];
  output: string[];
  steps: AnalysisStep[];
  complexity: string[];
  // A fenced block of the answer: the worked example, shown above the code.
  example: string | null;
  code: { language: string; text: string } | null;
};

const STEP_HEADING: Record<string, string> = {
  Approach: "Approach",
  Naive: "Naive Solution (Quick Start)",
  Optimal: "Optimal Solution",
};

const NAME_MAX = 60;

// What to call the task: its short title if the model gave one, else the start of
// the model's restatement (first sentence, trimmed), else "Analysis".
// A problem name the answer itself gives: in quotes ('This is LeetCode 2, "Add Two
// Numbers": ...') or after a LeetCode number ('LeetCode 37, Sudoku Solver: ...').
// Short and not a sentence, or it is not a name.
const QUOTED_NAME = /["“]([^"”]{3,60})["”]/;
const NUMBERED_NAME =
  /\bLeetCode\s*#?\d+\s*[,:\-–—]\s*([^:.\n"“]{3,60}?)\s*[:.]/i;
export function problemNameIn(text: string): string | null {
  const name = (QUOTED_NAME.exec(text) ??
    NUMBERED_NAME.exec(text))?.[1]?.trim();
  return name && !/[.!?]$/.test(name) ? name : null;
}

export function taskName(task: TaskView): string {
  const firstLine =
    approach(task)?.items.find((item) => item.kind === "line")?.text ?? "";
  const named = problemNameIn(firstLine);
  if (named) return named;
  const heading = taskHeading(task);
  const text = heading.restated ?? heading.title;
  const generic = TASK_KIND[task.kind].label;
  if (heading.restated === null && (task.title?.trim() ?? "") === "")
    return "Analysis";
  if (heading.restated === null && heading.title === generic) return "Analysis";
  const sentence =
    text.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?:\s]+$/, "") ?? "";
  return sentence.length <= NAME_MAX
    ? sentence
    : `${sentence.slice(0, NAME_MAX - 1).trimEnd()}…`;
}

export function analysisView(task: TaskView): AnalysisView {
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
  const example =
    approach(task)?.items.find((item) => item.kind === "code")?.text ?? null;
  const code = solution(task);
  return {
    title: taskName(task),
    problemType: TASK_KIND[task.kind].label,
    constraints: task.constraints
      .filter((each) => each.status === "current")
      .map((each) => each.text),
    input: lines("Input"),
    output: lines("Output"),
    steps,
    complexity: lines("Complexity"),
    example,
    code: code ? { language: code.language, text: code.code } : null,
  };
}

// ---- Chat -------------------------------------------------------------------

// "heard" and "typed" are what was said; "assistant" is the reply to it.
export type PanelRowKind = "heard" | "typed" | "assistant" | "system";
export type PanelRow = {
  key: string;
  kind: PanelRowKind;
  label: string;
  text: string;
  at: number;
  // The assistant's formatted answer: its lines and fenced code blocks.
  items?: readonly ApproachItem[];
  // The task an assistant answer belongs to: choosing the row shows that task.
  taskId?: string;
  // What the task is doing right now. The row shows it in place of the answer
  // until the answer exists, then beside it until the work is done.
  stage?: TaskStage;
};

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
): PanelRow[] {
  const heard: PanelRow[] = model.transcript.flatMap((row) =>
    row.type === "utterance" && !row.superseded
      ? [
          {
            key: `h-${row.sourceId}/${row.eventId}`,
            kind: "heard" as const,
            label: "Heard",
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
      label: "You",
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
        label: "Assistant",
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
  return [...heard, ...mine, ...assistant, ...lines]
    .filter((row) => row.kind === "system" || row.at > since)
    .sort((a, b) => a.at - b.at)
    .slice(-PANEL_ROWS);
}

export const clock = (at: number): string =>
  Number.isNaN(at) || at === 0
    ? ""
    : new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

// What the model said it could not see for the task on show: from its newest
// succeeded answer draft for the task's current revision, or none.
export function missingContextFor(
  actions: readonly LiveAction[],
  task: TaskView | undefined,
): LiveMissingContext | null {
  if (!task) return null;
  const draft = actions
    .filter(
      (action) =>
        action.taskId === task.taskId &&
        action.taskRevision === task.currentRevision &&
        action.actionKind === "draft-answer" &&
        action.dispatchStatus === "succeeded" &&
        (action.missingContext?.length ?? 0) > 0,
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  return draft?.missingContext ?? null;
}
