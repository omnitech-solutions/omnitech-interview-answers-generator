// Effective transcript view and supersession. A transcript.final carrying
// `supersedes` replaces the earlier segment in the effective view; work built
// on the superseded segment is marked stale elsewhere, never edited. The text
// is stored only to be handed to the policy port and is never inspected here.
import type { TranscriptFinal } from "@omnitech/active-session-contracts";
import type { Utterance } from "./ports.js";

export type CaptureSource = "microphone" | "application-audio";

// The wire's content.source, else the observation's source id when that names
// one of the two captured sources (older senders omit content.source).
const captureSourceOf = (
  observation: TranscriptFinal,
): CaptureSource | undefined => {
  const named = observation.content.source ?? observation.sourceId;
  return named === "microphone" || named === "application-audio"
    ? named
    : undefined;
};

export type Segment = {
  eventId: string;
  sourceId: string;
  speaker: string;
  // Which captured audio source produced the text; a label, never an identity.
  source?: CaptureSource;
  startMs: number;
  endMs: number;
  text: string;
  // Accepted ordinal assigned by the observation ledger.
  seq: number;
  supersededBy: string | null;
  // The first segment of the correction chain this one belongs to (its own id
  // when it corrects nothing), so a corrected question keeps its identity.
  originId: string;
};

export type TranscriptView = {
  segments: Readonly<Record<string, Segment>>;
  // Supersessions naming a segment that has not arrived yet.
  pendingSupersedes: Readonly<Record<string, string>>;
};

export const emptyTranscript = (): TranscriptView => ({
  segments: {},
  pendingSupersedes: {},
});

export type TranscriptApplied = {
  view: TranscriptView;
  // Segment ids newly superseded by this event (ids only).
  supersededIds: readonly string[];
};

export function applyTranscriptFinal(
  view: TranscriptView,
  observation: TranscriptFinal,
  seq: number,
): TranscriptApplied {
  const { content } = observation;
  const segments: Record<string, Segment> = { ...view.segments };
  const pending: Record<string, string> = { ...view.pendingSupersedes };
  const superseded: string[] = [];

  // A correction that raced ahead of its target marks the target on arrival.
  const bornSuperseded = pending[observation.eventId] ?? null;
  delete pending[observation.eventId];
  const corrected = content.supersedes;
  const source = captureSourceOf(observation);
  const originId =
    corrected && corrected !== observation.eventId
      ? (view.segments[corrected]?.originId ?? corrected)
      : observation.eventId;
  segments[observation.eventId] = {
    eventId: observation.eventId,
    sourceId: observation.sourceId,
    speaker: content.speaker,
    ...(source ? { source } : {}),
    startMs: content.startMs,
    endMs: content.endMs,
    text: content.text,
    seq,
    supersededBy: bornSuperseded,
    originId,
  };
  if (bornSuperseded) superseded.push(observation.eventId);

  // [GUARD] A segment cannot supersede itself.
  const target = content.supersedes;
  if (target && target !== observation.eventId) {
    const earlier = segments[target];
    if (!earlier) pending[target] = observation.eventId;
    else if (earlier.supersededBy === null) {
      segments[target] = { ...earlier, supersededBy: observation.eventId };
      superseded.push(target);
    }
  }
  return {
    view: { segments, pendingSupersedes: pending },
    supersededIds: superseded,
  };
}

// Effective view: superseded segments dropped, ordered by media time then arrival.
export function effectiveSegments(view: TranscriptView): readonly Segment[] {
  return Object.values(view.segments)
    .filter((segment) => segment.supersededBy === null)
    .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
}

export const isSuperseded = (view: TranscriptView, eventId: string): boolean =>
  view.segments[eventId]?.supersededBy != null;

// The longest media-time silence between two segments of one speaker that
// still reads as one utterance. A longer pause starts a new utterance, so the
// boundary is a fact of the transcript and not of when a worker looked at it.
export const MERGE_GAP_MS = 1_500;

// Merge consecutive same-speaker segments split by backchannel interleaving.
// `isBackchannel` is the policy's verdict; the core never reads the text.
export function coalesceSegments(
  segments: readonly Segment[],
  isBackchannel: (segment: Segment) => boolean,
): readonly Utterance[] {
  const utterances: Utterance[] = [];
  let open: { speaker: string; parts: Segment[] } | null = null;
  const flush = () => {
    if (!open) return;
    const first = open.parts[0] as Segment;
    const last = open.parts[open.parts.length - 1] as Segment;
    utterances.push({
      id: first.eventId,
      speaker: open.speaker,
      ...(first.source ? { source: first.source } : {}),
      segmentIds: open.parts.map((part) => part.eventId),
      startMs: first.startMs,
      endMs: last.endMs,
      text: open.parts.map((part) => part.text).join(" "),
      parts: open.parts.map((part) => ({
        id: part.eventId,
        originId: part.originId,
        text: part.text,
      })),
    });
    open = null;
  };
  for (const segment of segments) {
    const previous = open?.parts[open.parts.length - 1];
    if (
      open &&
      previous &&
      segment.speaker === open.speaker &&
      segment.startMs - previous.endMs <= MERGE_GAP_MS
    ) {
      open.parts.push(segment);
    } else if (
      open &&
      segment.speaker !== open.speaker &&
      isBackchannel(segment)
    ) {
      // The other speaker only interjected; the running utterance continues,
      // but the backchannel is itself kept as its own utterance.
      utterances.push({
        id: segment.eventId,
        speaker: segment.speaker,
        ...(segment.source ? { source: segment.source } : {}),
        segmentIds: [segment.eventId],
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      });
    } else {
      flush();
      open = { speaker: segment.speaker, parts: [segment] };
    }
  }
  flush();
  return utterances.sort((a, b) => a.startMs - b.startMs);
}
