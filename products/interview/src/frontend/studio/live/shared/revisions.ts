// A task's revisions, as both the native window and the web page describe
// them: one list (newest first), which revision is on show, and the view of the
// task AT that revision. A revision is a view of the same task, never another
// row or entity. Which one is on show is view-only page state (the picks in
// focus-presentation); the server never hears of it, and a follow-up still goes
// to the task's CURRENT revision (task-target.ts). Pure.
import type { ActivityRun } from "../session-runs";
import {
  constraintHistory,
  type TaskRevisionView,
  type TaskView,
} from "../session-tasks";
import { REVISION_REASON_LABEL } from "./task-screenshots";

// What produced a revision, from what the stream records and nothing else: the
// owner's own input says so (regenerate, added screenshot); the first revision
// is the first answer; any other is a follow-up.
export type RevisionCause = string;

export type RevisionEntry = {
  revision: number;
  isCurrent: boolean;
  isSelected: boolean;
  // When the revision's first work began (ISO).
  at: string;
  cause: RevisionCause;
  // A newer revision exists.
  outdated: boolean;
  hasAnswer: boolean;
};

export const FIRST_ANSWER = "First answer";
export const FOLLOW_UP = "Follow-up";
export const NO_QUESTION_FOUND = "No question found";

export function revisionCause(
  task: TaskView,
  revision: TaskRevisionView,
): RevisionCause {
  if (revision.noQuestion) return NO_QUESTION_FOUND;
  if (revision.reason) return REVISION_REASON_LABEL[revision.reason];
  return revision === task.revisions[0] ? FIRST_ANSWER : FOLLOW_UP;
}

// The revision on show: the person's pick if it is still one of the task's
// revisions, else the current one. A pick is only kept for an OLDER revision
// (see pickRevision), so "no pick" means follow the newest.
export function selectedRevisionOf(
  task: {
    taskId: string;
    currentRevision: number;
    revisions: readonly { revision: number }[];
  },
  picks: Readonly<Record<string, number>>,
): number {
  const pick = picks[task.taskId];
  return pick !== undefined && task.revisions.some((r) => r.revision === pick)
    ? pick
    : task.currentRevision;
}

// What to remember when a revision is chosen: nothing for the current one (the
// view follows whichever revision arrives next), the number for an older one
// (deliberately kept, with "current is m" beside it).
export const pickOf = (task: TaskView, revision: number): number | null =>
  revision === task.currentRevision ? null : revision;

export function revisionList(
  task: TaskView,
  selected: number = task.currentRevision,
): RevisionEntry[] {
  return [...task.revisions].reverse().map((revision) => ({
    revision: revision.revision,
    isCurrent: revision.revision === task.currentRevision,
    isSelected: revision.revision === selected,
    at: revision.firstSeenAt,
    cause: revisionCause(task, revision),
    outdated: revision.revision < task.currentRevision,
    hasAnswer: revision.answer !== null || revision.code !== null,
  }));
}

// The task line: "rev 2 of 3", and, only when an older revision is on show,
// what that means.
export type RevisionLine = {
  label: string;
  viewingEarlier: boolean;
  // "Viewing rev 1, current is rev 3"; null while the current one is on show.
  note: string | null;
};

export function revisionLine(task: TaskView, selected: number): RevisionLine {
  const viewingEarlier = selected !== task.currentRevision;
  return {
    label: `rev ${selected} of ${task.revisions.length}`,
    viewingEarlier,
    note: viewingEarlier
      ? `Viewing rev ${selected}, current is rev ${task.currentRevision}`
      : null,
  };
}

// The composer's line while an older revision is on show: the follow-up still
// goes to the current one.
export const followUpNote = (
  task: TaskView,
  selected: number,
): string | null =>
  selected === task.currentRevision
    ? null
    : `Follow-up goes to rev ${task.currentRevision}`;

// The task as it stood at a revision: that revision's answer, code, tests,
// constraints and runs, so every panel that reads a task follows the pick with
// no second code path. The current revision is the task itself. `revisions` and
// `currentRevision` stay the task's own (the list and the follow-up target).
export function taskAtRevision(task: TaskView, revision: number): TaskView {
  const at = task.revisions.find((r) => r.revision === revision);
  if (!at || at === task.current) return task;
  const upTo = task.revisions.filter((r) => r.revision <= revision);
  return {
    ...task,
    current: at,
    answer: at.answer,
    answerStale: false,
    code: at.code,
    codeStale: false,
    // The revision's own solution is what its Code view draws, never another
    // revision's (a revision without code has none); its Workspace link is
    // the one its own result carries.
    draftCode: at.code,
    draft:
      at.code?.workspace?.published === true
        ? {
            workspaceId: at.code.workspace.workspaceId,
            artifactId: at.code.workspace.artifactId,
            artifactRevision: at.code.workspace.artifactRevision,
          }
        : null,
    suggestion: null,
    heldResult: false,
    constraints: constraintHistory(upTo),
    title:
      [...upTo]
        .reverse()
        .map((r) => r.answer?.codingBrief?.restatement ?? null)
        .find((text) => text !== null) ?? null,
  };
}

// What a revision says in a chat row: its own draft, or, until it has one, its
// honest state (never another revision's text). A withheld draft says what the
// run says.
export type RevisionText = { text: string | null; note: string | null };

function noteOf(run: ActivityRun | null): string {
  if (!run) return "Waiting for the answer.";
  if (run.state === "running" || run.state === "cancelling")
    return `${run.label}…`;
  if (run.state === "published" || run.state === "superseded")
    return "The answer has no text.";
  return run.reasonLabel ?? run.label;
}

export function revisionText(revision: TaskRevisionView): RevisionText {
  if (revision.noQuestion) return { text: null, note: NO_QUESTION_FOUND };
  const draft = revision.answer?.draft ?? "";
  return draft.trim() !== ""
    ? { text: draft, note: null }
    : { text: null, note: noteOf(revision.answerRun) };
}
