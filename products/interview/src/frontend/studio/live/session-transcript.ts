// Transcript rows: what the Transcript tab lists, in the order things happened.
// Utterances carry the label of the capture source they arrived on (never a
// speaker identity); screenshots, capture gaps and disconnects are rows of
// their own; and ONE row per task marks where the task first got work and
// carries what it said at each revision. Pure.
import type {
  LiveAction,
  LiveCaptureSource,
  LiveObservation,
} from "@omnitech/interview-contracts";
import {
  parseDisconnectedContent,
  parseGapContent,
  parseSnapshotContent,
  parseTranscriptContent,
} from "./session-results";
import { SOURCE_LABEL, type SourceIndex, sourceIndex } from "./session-sources";
import type { TaskKind, TaskView } from "./session-tasks";
import type { NoQuestionNote } from "./shared/no-question";
import {
  type RevisionText,
  revisionCause,
  revisionText,
} from "./shared/revisions";
import {
  type SnapshotRef,
  snapshotLabelOf,
  snapshotOrdinals,
  sourceSnapshotOf,
} from "./shared/task-card-model";
import { taskOrdinal } from "./shared/task-target";

export type TranscriptRow =
  | {
      type: "utterance";
      sequence: number;
      // Event ids are unique per source, not per session (dedup is by both).
      sourceId: string;
      eventId: string;
      receivedAt: string;
      source: LiveCaptureSource | null;
      // "Microphone", "App audio" or "Audio" when the source is unknown.
      sourceLabel: string;
      // The label the companion put on the segment (a channel, not a person).
      speakerLabel: string;
      text: string;
      // A later segment corrected this one: it is kept, greyed, and any answer
      // built on it was marked stale by the server. The wire carries only
      // finalised segments, so there is no partial state to show.
      superseded: boolean;
      correctsEventId: string | null;
    }
  | { type: "unreadable"; sequence: number; receivedAt: string }
  | {
      type: "screenshot";
      sequence: number;
      sourceId: string;
      eventId: string;
      receivedAt: string;
      windowLabel: string;
      artifactId: string | null;
    }
  | {
      type: "gap";
      sequence: number;
      receivedAt: string;
      source: LiveCaptureSource;
      sourceLabel: string;
      durationMs: number;
      reason: string;
    }
  | {
      type: "disconnect";
      sequence: number;
      receivedAt: string;
      source: LiveCaptureSource;
      sourceLabel: string;
      reason: string;
    }
  | {
      // Captures that showed no interview question: a note, never a task.
      // Consecutive ones (screenshots between them aside) share one row.
      type: "no-question";
      at: string;
      notes: NoQuestionNote[];
    }
  | {
      type: "task";
      taskId: string;
      // 1-based, in the order tasks became real (realSince): "T1".
      ordinal: number;
      kind: TaskKind;
      // When the task's first work began: where the row sits.
      at: string;
      currentRevision: number;
      // Every revision's own text, oldest first. The row shows the one the
      // person chose (see selectedRevisionOf); revisions never add rows.
      revisions: {
        revision: number;
        at: string;
        cause: string;
        text: RevisionText;
      }[];
    };

const segmentKey = (ids: { sourceId: string; eventId: string }): string =>
  `${ids.sourceId}\u0000${ids.eventId}`;

// [SAFETY] A known row whose content cannot be read is shown as a placeholder,
// never dropped (a silent gap reads as "nothing was heard"). Its content is not
// shown or logged.
const unreadable = (observation: LiveObservation): TranscriptRow => ({
  type: "unreadable",
  sequence: observation.sequence,
  receivedAt: observation.receivedAt,
});

function observationRow(
  observation: LiveObservation,
  index: SourceIndex,
  corrected: ReadonlySet<string>,
): TranscriptRow | null {
  const { sequence, receivedAt } = observation;
  if (observation.kind === "transcript.final") {
    const content = parseTranscriptContent(observation.content.body);
    if (!content) return unreadable(observation);
    const source = index.sourceOf(observation);
    return {
      type: "utterance",
      sequence,
      sourceId: observation.sourceId,
      eventId: observation.eventId,
      receivedAt,
      source,
      sourceLabel: source ? SOURCE_LABEL[source] : "Audio",
      speakerLabel: content.speaker,
      text: content.text,
      superseded: corrected.has(segmentKey(observation)),
      correctsEventId: content.supersedes ?? null,
    };
  }
  if (observation.kind === "screen.snapshot") {
    const content = parseSnapshotContent(observation.content.body);
    if (!content) return unreadable(observation);
    return {
      type: "screenshot",
      sequence,
      sourceId: observation.sourceId,
      eventId: observation.eventId,
      receivedAt,
      windowLabel: content.windowLabel,
      artifactId: observation.screenshotArtifactId,
    };
  }
  if (observation.kind === "capture.gap") {
    const content = parseGapContent(observation.content.body);
    if (!content) return unreadable(observation);
    return {
      type: "gap",
      sequence,
      receivedAt,
      source: content.source,
      sourceLabel: SOURCE_LABEL[content.source],
      durationMs: content.durationMs,
      reason: content.reason,
    };
  }
  if (observation.kind === "source.disconnected") {
    const content = parseDisconnectedContent(observation.content.body);
    if (!content) return unreadable(observation);
    return {
      type: "disconnect",
      sequence,
      receivedAt,
      source: content.source,
      sourceLabel: SOURCE_LABEL[content.source],
      reason: content.reason,
    };
  }
  // An unknown kind from a newer server is not guessed at.
  return null;
}

const timeOf = (iso: string) => Date.parse(iso) || 0;

export function transcriptRows(
  observations: readonly LiveObservation[],
  tasks: readonly TaskView[],
  noQuestion: readonly NoQuestionNote[] = [],
): TranscriptRow[] {
  const index = sourceIndex(observations);
  const corrected = new Set<string>();
  const known = new Set(
    observations
      .filter((observation) => observation.kind === "transcript.final")
      .map(segmentKey),
  );
  for (const observation of observations) {
    if (observation.kind !== "transcript.final") continue;
    const content = parseTranscriptContent(observation.content.body);
    if (!content?.supersedes) continue;
    // Event ids are unique per source, so a correction names a segment of its
    // own source. The server resolves a bare event id session-wide, so when
    // the source has no such segment, any source's segment with that id is it.
    const sameSource = {
      sourceId: observation.sourceId,
      eventId: content.supersedes,
    };
    if (known.has(segmentKey(sameSource)))
      corrected.add(segmentKey(sameSource));
    else
      for (const other of observations)
        if (
          other.kind === "transcript.final" &&
          other.eventId === content.supersedes
        )
          corrected.add(segmentKey(other));
  }
  const rows = observations
    .map((observation) => observationRow(observation, index, corrected))
    .filter((row): row is TranscriptRow => row !== null);

  // A task row goes before the first observation received after the task's
  // first work began, so it reads where the question was asked.
  const marks: Extract<TranscriptRow, { type: "task" }>[] = tasks.map(
    (task) => ({
      type: "task" as const,
      taskId: task.taskId,
      ordinal: taskOrdinal(tasks, task.taskId) ?? 0,
      kind: task.kind,
      at: task.firstSeenAt,
      currentRevision: task.currentRevision,
      revisions: task.revisions.map((revision) => ({
        revision: revision.revision,
        at: revision.firstSeenAt,
        cause: revisionCause(task, revision),
        text: revisionText(revision),
      })),
    }),
  );
  const notes: Extract<TranscriptRow, { type: "no-question" }>[] =
    noQuestion.map((note) => ({
      type: "no-question" as const,
      at: note.at,
      notes: [note],
    }));
  const placed: ((typeof marks)[number] | (typeof notes)[number])[] = [
    ...marks,
    ...notes,
  ];
  placed.sort((a, b) => timeOf(a.at) - timeOf(b.at));
  const merged: TranscriptRow[] = [];
  let next = 0;
  for (const row of rows) {
    const rowTime = "receivedAt" in row ? timeOf(row.receivedAt) : 0;
    while (
      next < placed.length &&
      timeOf(placed[next]?.at as string) <= rowTime
    )
      merged.push(placed[next++] as TranscriptRow);
    merged.push(row);
  }
  while (next < placed.length) merged.push(placed[next++] as TranscriptRow);
  return joinNotes(merged);
}

// Consecutive no-question notes share one row: only screenshots (one per
// capture, so always between them under Auto) may sit between them. Anything
// else, a heard line or a real task, starts a new group.
function joinNotes(rows: readonly TranscriptRow[]): TranscriptRow[] {
  const out: TranscriptRow[] = [];
  let open: Extract<TranscriptRow, { type: "no-question" }> | null = null;
  for (const row of rows) {
    if (row.type === "no-question") {
      if (open) open.notes.push(...row.notes);
      else {
        open = { ...row, notes: [...row.notes] };
        out.push(open);
      }
      continue;
    }
    if (row.type !== "screenshot") open = null;
    out.push(row);
  }
  return out;
}

// The screenshot numbers the Transcript shows: "S1" beside each screenshot and
// "S1 analysed → T1 started" where a task is known to rest on one. The labels
// come from the shared task card model; a screenshot or a link that is not
// known has no label, and the row then says nothing about it.
export type TranscriptLabels = {
  snapshot(ref: SnapshotRef): string | null;
  taskSnapshot(taskId: string): string | null;
};

export const NO_LABELS: TranscriptLabels = {
  snapshot: () => null,
  taskSnapshot: () => null,
};

export function transcriptLabels(input: {
  tasks: readonly TaskView[];
  actions: readonly LiveAction[];
  observations: readonly LiveObservation[];
}): TranscriptLabels {
  const ordinals = snapshotOrdinals(input.observations);
  return {
    snapshot: (ref) => snapshotLabelOf(ref, ordinals),
    taskSnapshot: (taskId) =>
      snapshotLabelOf(sourceSnapshotOf(input.actions, taskId), ordinals),
  };
}
