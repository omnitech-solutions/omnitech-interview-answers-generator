// Captures that showed no interview question (D36). They are not tasks: no
// number, no chip, no answer. Each is one small note ("S15 captured: no
// question found"); a run of consecutive notes collapses into one line so Auto
// does not fill the transcript. One definition for the web Transcript and the
// native chat. Pure.
import type { LiveAction } from "@omnitech/interview-contracts";
import type { TaskView } from "../session-tasks";
import { type SnapshotRef, sourceSnapshotOf } from "./task-card-model";

export const NO_QUESTION_NOTES = {
  // This many consecutive notes become one "n captures with no question".
  collapseAt: 3,
} as const;

export type NoQuestionNote = {
  taskId: string;
  // When the capture was analysed.
  at: string;
  // The screenshot it was made from, when known.
  snapshot: SnapshotRef | null;
};

// One note per no-question capture, from the tasks deriveNoQuestionTasks found.
export function noQuestionNotes(
  tasks: readonly TaskView[],
  actions: readonly LiveAction[],
): NoQuestionNote[] {
  return tasks.map((task) => ({
    taskId: task.taskId,
    at: task.current.firstSeenAt,
    snapshot: sourceSnapshotOf(actions, task.taskId),
  }));
}

// The lines a run of consecutive notes shows. `labels` holds each note's
// screenshot label ("S15"), or null when it is not known.
export function noQuestionLines(labels: readonly (string | null)[]): string[] {
  if (labels.length >= NO_QUESTION_NOTES.collapseAt)
    return [`${labels.length} captures with no question`];
  return labels.map((label) =>
    label ? `${label} captured: no question found` : "No question found",
  );
}

// The honest line while the newest capture found no question. It says only
// what the server said, plus what Auto does about it; null otherwise.
export const NO_QUESTION_STATUS = {
  auto: "No question on screen. Auto is holding until the screen changes.",
  manual: "No question found in the last capture.",
} as const;

export function noQuestionStatus(
  newestIsNoQuestion: boolean,
  autoOn: boolean,
): string | null {
  if (!newestIsNoQuestion) return null;
  return autoOn ? NO_QUESTION_STATUS.auto : NO_QUESTION_STATUS.manual;
}
