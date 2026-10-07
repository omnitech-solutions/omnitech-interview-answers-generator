// What the answer header and the transcript say about captures: the capture
// events as chips ("S3 captured", "S4 · no question found") and the header line
// "Last capture 14:05 · no question found". Derived from the session's own
// screenshot observations and the no-question notes the panel already builds.
// Pure; labels and times only, never screenshot content.
import type { LiveObservation } from "@omnitech/interview-contracts";
import type { NoQuestionNote } from "../../shared/no-question";
import {
  snapshotLabelOf,
  snapshotOrdinals,
} from "../../shared/task-card-model";

export type CaptureEventKind = "captured" | "no-question";

export type CaptureEventChip = {
  key: string;
  kind: CaptureEventKind;
  // "S3 captured" or "S4 · no question found".
  label: string;
  // Epoch ms of the capture, 0 when the server's time did not parse.
  at: number;
  // Local "HH:MM".
  time: string;
};

const SCREEN_SNAPSHOT = "screen.snapshot";
const NO_QUESTION_TEXT = "no question found";

// Local clock time as "HH:MM".
export function clockTime(at: number | string | Date): string {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// One chip per screenshot, oldest first. A screenshot that a no-question note
// rests on says so; a capture whose answer is not in yet is just "captured".
export function captureEventChips(input: {
  observations: readonly LiveObservation[];
  noQuestion: readonly NoQuestionNote[];
}): CaptureEventChip[] {
  const ordinals = snapshotOrdinals(input.observations);
  const empty = new Set(
    input.noQuestion.flatMap((note) => {
      const label = note.snapshot
        ? snapshotLabelOf(note.snapshot, ordinals)
        : null;
      return label ? [label] : [];
    }),
  );
  const seen = new Set<string>();
  return input.observations
    .filter((observation) => observation.kind === SCREEN_SNAPSHOT)
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((observation) => {
      const label = snapshotLabelOf(observation, ordinals);
      if (!label || seen.has(label)) return [];
      seen.add(label);
      const at = Date.parse(observation.receivedAt) || 0;
      const none = empty.has(label);
      return [
        {
          key: `capture-${observation.sourceId}-${observation.eventId}`,
          kind: none ? ("no-question" as const) : ("captured" as const),
          label: none ? `${label} · ${NO_QUESTION_TEXT}` : `${label} captured`,
          at,
          time: at === 0 ? "" : clockTime(at),
        },
      ];
    });
}

// "Last capture 14:05 · no question found", or "Last capture 14:05" when that
// capture had a question, or null before any capture.
export function answerHeaderMeta(
  chips: readonly CaptureEventChip[],
): string | null {
  const last = chips[chips.length - 1];
  if (!last) return null;
  const head = last.time ? `Last capture ${last.time}` : "Last capture";
  return last.kind === "no-question" ? `${head} · ${NO_QUESTION_TEXT}` : head;
}
