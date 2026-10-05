// Transcript rows: what the Transcript tab lists, in the order things happened.
// Utterances carry the label of the capture source they arrived on (never a
// speaker identity); screenshots, capture gaps and disconnects are rows of
// their own; and a "new task" row marks where each task revision first got
// work. Pure.
import type {
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
import {
  type SnapshotRef,
  snapshotLabelOf,
  snapshotOrdinals,
  taskCardModel,
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
      type: "new-task";
      taskId: string;
      // 1-based, in creation order: "T1".
      ordinal: number;
      revision: number;
      kind: TaskKind;
      // The revision after the first: a changed or follow-up task.
      revised: boolean;
      at: string;
    };

const segmentKey = (ids: { sourceId: string; eventId: string }): string =>
  `${ids.sourceId}\u0000${ids.eventId}`;

function observationRow(
  observation: LiveObservation,
  index: SourceIndex,
  corrected: ReadonlySet<string>,
): TranscriptRow | null {
  const { sequence, receivedAt } = observation;
  if (observation.kind === "transcript.final") {
    const content = parseTranscriptContent(observation.content.body);
    if (!content) return null;
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
    if (!content) return null;
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
    if (!content) return null;
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
    if (!content) return null;
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
  const marks: Extract<TranscriptRow, { type: "new-task" }>[] = tasks.flatMap(
    (task) =>
      task.revisions.map((revision) => ({
        type: "new-task" as const,
        taskId: task.taskId,
        ordinal: taskOrdinal(tasks, task.taskId) ?? 0,
        revision: revision.revision,
        kind: task.kind,
        revised: revision.revision > (task.revisions[0]?.revision ?? 0),
        at: revision.firstSeenAt,
      })),
  );
  marks.sort((a, b) => timeOf(a.at) - timeOf(b.at));
  const merged: TranscriptRow[] = [];
  let next = 0;
  for (const row of rows) {
    const rowTime = "receivedAt" in row ? timeOf(row.receivedAt) : 0;
    while (next < marks.length && timeOf(marks[next]?.at as string) <= rowTime)
      merged.push(marks[next++] as TranscriptRow);
    merged.push(row);
  }
  while (next < marks.length) merged.push(marks[next++] as TranscriptRow);
  return merged;
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
  actions: Parameters<typeof taskCardModel>[0]["actions"];
  observations: Parameters<typeof taskCardModel>[0]["observations"];
  deviceOnly: boolean;
}): TranscriptLabels {
  const ordinals = snapshotOrdinals(input.observations);
  const byTask = new Map<string, string | null>();
  for (const task of input.tasks)
    byTask.set(
      task.taskId,
      taskCardModel({ ...input, selectedTaskId: task.taskId })?.snapshotLabel ??
        null,
    );
  return {
    snapshot: (ref) => snapshotLabelOf(ref, ordinals),
    taskSnapshot: (taskId) => byTask.get(taskId) ?? null,
  };
}
