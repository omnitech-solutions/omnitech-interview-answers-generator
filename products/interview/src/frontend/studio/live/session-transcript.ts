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

export type TranscriptRow =
  | {
      type: "utterance";
      sequence: number;
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
      revision: number;
      kind: TaskKind;
      // The revision after the first: a changed or follow-up task.
      revised: boolean;
      at: string;
    };

function observationRow(
  observation: LiveObservation,
  index: SourceIndex,
  corrected: ReadonlySet<string>,
): TranscriptRow | null {
  const { sequence, receivedAt } = observation;
  if (observation.kind === "transcript.final") {
    const content = parseTranscriptContent(observation.content);
    if (!content) return null;
    const source = index.sourceOf(observation);
    return {
      type: "utterance",
      sequence,
      eventId: observation.eventId,
      receivedAt,
      source,
      sourceLabel: source ? SOURCE_LABEL[source] : "Audio",
      speakerLabel: content.speaker,
      text: content.text,
      superseded: corrected.has(observation.eventId),
      correctsEventId: content.supersedes ?? null,
    };
  }
  if (observation.kind === "screen.snapshot") {
    const content = parseSnapshotContent(observation.content);
    if (!content) return null;
    return {
      type: "screenshot",
      sequence,
      receivedAt,
      windowLabel: content.windowLabel,
      artifactId: observation.screenshotArtifactId,
    };
  }
  if (observation.kind === "capture.gap") {
    const content = parseGapContent(observation.content);
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
    const content = parseDisconnectedContent(observation.content);
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
  for (const observation of observations) {
    if (observation.kind !== "transcript.final") continue;
    const content = parseTranscriptContent(observation.content);
    if (content?.supersedes) corrected.add(content.supersedes);
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
