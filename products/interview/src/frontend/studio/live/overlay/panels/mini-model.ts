// What the Mini player says, from the shared task card and the phase the
// toolbar already names. Nothing is re-derived: the stage wording is the
// strip's (`phaseLabel`) and the card's own stage states.
import type { TaskCard } from "../../shared/task-card-model";
import { STAGE_PRESENTATION } from "../../shared/task-card-model";
import { phaseLabel } from "./toolbar-config";

export const HEADLINE_MAX = 90;

// The first sentence of the published answer, one line, never the prompt.
export function headlineOf(text: string | null): string | null {
  if (text === null) return null;
  const plain = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (plain === "") return null;
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain;
  return sentence.length > HEADLINE_MAX
    ? `${sentence.slice(0, HEADLINE_MAX - 1).trimEnd()}…`
    : sentence;
}

// Drafting an answer / Solutioning / Answer ready / Stopped, or the stage's own
// word (Waiting) before anything has run.
export function miniStage(input: {
  open: boolean;
  phase: "capturing" | "analyzing" | null;
  activityKey: string;
  card: TaskCard | null;
}): string | null {
  const running = phaseLabel(input.phase, input.activityKey);
  if (running !== null) return running;
  if (!input.open) return "Session ended";
  const answer = input.card?.stages[0];
  if (!answer) return null;
  return answer.state === "done"
    ? "Answer ready"
    : STAGE_PRESENTATION[answer.state].word;
}

export const missingHint = (count: number): string =>
  `${count} ${count === 1 ? "thing" : "things"} may be missing`;
