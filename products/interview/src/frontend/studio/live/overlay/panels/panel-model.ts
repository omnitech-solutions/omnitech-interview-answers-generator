// What the analysis and chat panels say, derived from the session's own
// published results and transcript. Pure; text from the session is inert.
import type { LiveViewModel } from "../../session-state";
import type { TaskView } from "../../session-tasks";
import { TASK_KIND } from "../../task-panels";
import {
  type ApproachItem,
  approach,
  type ChatEntry,
  solution,
} from "../overlay-model";
import { taskHeading } from "../overlay-task";

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
export function taskName(task: TaskView): string {
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
};
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
  const assistant: PanelRow[] = model.tasks.flatMap((task) => {
    const shown = approach(task);
    const first = shown?.items.find((item) => item.kind === "line");
    if (!shown || !first) return [];
    const last = task.revisions[task.revisions.length - 1];
    return [
      {
        key: `a-${task.taskId}-${task.currentRevision}`,
        kind: "assistant" as const,
        label: "Assistant",
        text: shown.items.map((item) => item.text).join("\n"),
        items: shown.items,
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
