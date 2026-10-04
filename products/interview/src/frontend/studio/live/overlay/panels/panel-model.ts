// What the analysis and chat panels say, derived from the session's own
// published results and transcript. Pure; text from the session is inert.
import type { LiveViewModel } from "../../session-state";
import type { TaskView } from "../../session-tasks";
import { type ApproachItem, approach, type ChatEntry } from "../overlay-model";

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

// ---- Chat -------------------------------------------------------------------

export type PanelRowKind = "heard" | "typed" | "assistant";
export type PanelRow = {
  key: string;
  kind: PanelRowKind;
  label: string;
  text: string;
  at: number;
};
export const PANEL_ROWS = 60;

// Heard speech (the server's transcript), what was typed or dictated here, and
// the assistant's published answers, oldest first.
export function panelRows(
  model: LiveViewModel,
  entries: readonly ChatEntry[],
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
  const mine: PanelRow[] = entries.map((entry) => ({
    key: entry.key,
    kind: "typed",
    label: entry.kind === "Auto" ? "Auto" : "You",
    text: entry.text,
    at: entry.at,
  }));
  const assistant: PanelRow[] = model.tasks.flatMap((task) => {
    const first = approach(task)?.items.find((item) => item.kind === "line");
    if (!first) return [];
    const last = task.revisions[task.revisions.length - 1];
    return [
      {
        key: `a-${task.taskId}-${task.currentRevision}`,
        kind: "assistant" as const,
        label: "Assistant",
        text: task.title ? `${task.title}: ${first.text}` : first.text,
        at: Date.parse(last?.firstSeenAt ?? "") || 0,
      },
    ];
  });
  return [...heard, ...mine, ...assistant]
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
