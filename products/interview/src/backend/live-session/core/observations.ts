// Observation ordering and dedup (rule:idempotent-observation). The key is
// (sourceId, eventId); a resend returns the ORIGINAL acknowledgement unchanged.
// Ordering is per source by `sequence`, tolerant of late arrival, and gaps are
// recorded as state, never as tasks. Pure: the ledger is returned, not mutated.
import {
  type ControlStatus,
  type Observation,
  type RefusalCode,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import { ingestRefusal, type SessionStatus } from "./status";

type AcceptedAck = {
  version: typeof WIRE_VERSION;
  status: "accepted";
  sourceId: string;
  eventId: string;
  control: ControlStatus;
};

type SourceLedger = {
  highestSequence: number;
  // Sequences below the highest seen that have not arrived yet.
  missing: readonly number[];
  // Sequences given up on once they fall outside the late-arrival window.
  lostCount: number;
  connected: boolean;
  disconnectReason: string | null;
  captureGapCount: number;
  captureGapMs: number;
};

export type ObservationLedger = {
  // Next session-wide accepted ordinal.
  nextSeq: number;
  acks: Readonly<Record<string, { seq: number; ack: AcceptedAck }>>;
  sources: Readonly<Record<string, SourceLedger>>;
};

export const emptyLedger = (): ObservationLedger => ({
  nextSeq: 1,
  acks: {},
  sources: {},
});

// How far behind the highest sequence a missing event may still arrive.
const DEFAULT_LATE_TOLERANCE = 16;

type ArrivalOrder = "in-order" | "gap-ahead" | "late" | "out-of-window";

type SequenceGap = {
  sourceId: string;
  fromSequence: number;
  toSequence: number;
};

export type ObservationDecision =
  | {
      decision: "accepted";
      seq: number;
      ack: AcceptedAck;
      order: ArrivalOrder;
      newGaps: readonly SequenceGap[];
      // capture.gap and source.disconnected never open tasks.
      mayOpenTask: boolean;
      ledger: ObservationLedger;
    }
  | {
      decision: "duplicate";
      ack: {
        version: typeof WIRE_VERSION;
        status: "duplicate";
        original: AcceptedAck;
      };
      ledger: ObservationLedger;
    }
  | { decision: "refused"; code: RefusalCode; ledger: ObservationLedger };

export const dedupKey = (sourceId: string, eventId: string): string =>
  JSON.stringify([sourceId, eventId]);

export type ObservationInput = {
  observation: Observation;
  sessionStatus: SessionStatus;
  // Reported in the acknowledgement as of this decision.
  control: ControlStatus;
  lateTolerance?: number;
};

const freshSource = (sequence: number): SourceLedger => ({
  highestSequence: sequence,
  missing: [],
  lostCount: 0,
  connected: true,
  disconnectReason: null,
  captureGapCount: 0,
  captureGapMs: 0,
});

export function decideObservation(
  ledger: ObservationLedger,
  input: ObservationInput,
): ObservationDecision {
  const { observation } = input;
  const tolerance = input.lateTolerance ?? DEFAULT_LATE_TOLERANCE;
  // [GUARD] A session that is not capturing accepts nothing, resend or not.
  const refusal = ingestRefusal(input.sessionStatus);
  if (refusal) return { decision: "refused", code: refusal, ledger };

  // [STRATEGY] A resend gets the original acknowledgement, never a new decision.
  const key = dedupKey(observation.sourceId, observation.eventId);
  const prior = ledger.acks[key];
  if (prior)
    return {
      decision: "duplicate",
      ack: { version: WIRE_VERSION, status: "duplicate", original: prior.ack },
      ledger,
    };

  // Per-source ordering: classify the arrival and track what is missing.
  const known = ledger.sources[observation.sourceId];
  const sequence = observation.sequence;
  let source: SourceLedger;
  let order: ArrivalOrder;
  const newGaps: SequenceGap[] = [];
  if (!known) {
    // The first event seen fixes the baseline; earlier sequences are not gaps.
    source = freshSource(sequence);
    order = "in-order";
  } else if (sequence > known.highestSequence) {
    order = sequence === known.highestSequence + 1 ? "in-order" : "gap-ahead";
    const missing = [...known.missing];
    if (order === "gap-ahead") {
      for (let s = known.highestSequence + 1; s < sequence; s += 1)
        missing.push(s);
      newGaps.push({
        sourceId: observation.sourceId,
        fromSequence: known.highestSequence + 1,
        toSequence: sequence - 1,
      });
    }
    // Missing events beyond the window are written off, not waited for.
    const waiting = missing.filter((s) => sequence - s <= tolerance);
    source = {
      ...known,
      highestSequence: sequence,
      missing: waiting,
      lostCount: known.lostCount + (missing.length - waiting.length),
    };
  } else if (known.missing.includes(sequence)) {
    order = "late";
    source = {
      ...known,
      missing: known.missing.filter((s) => s !== sequence),
    };
  } else {
    // At or below the highest, and not awaited: accepted (data is never
    // dropped) but flagged as outside the ordering window.
    order = "out-of-window";
    source = known;
  }

  // Connectivity and capture gaps are recorded as state only.
  if (observation.kind === "source.disconnected")
    source = {
      ...source,
      connected: false,
      disconnectReason: observation.content.reason,
    };
  else if (observation.kind === "capture.gap")
    source = {
      ...source,
      captureGapCount: source.captureGapCount + 1,
      captureGapMs: source.captureGapMs + observation.content.durationMs,
    };
  else if (!source.connected)
    // Any later observation from the source shows it is back.
    source = { ...source, connected: true, disconnectReason: null };

  const ack: AcceptedAck = {
    version: WIRE_VERSION,
    status: "accepted",
    sourceId: observation.sourceId,
    eventId: observation.eventId,
    control: input.control,
  };
  const seq = ledger.nextSeq;
  return {
    decision: "accepted",
    seq,
    ack,
    order,
    newGaps,
    mayOpenTask:
      observation.kind === "transcript.final" ||
      observation.kind === "screen.snapshot",
    ledger: {
      nextSeq: seq + 1,
      acks: { ...ledger.acks, [key]: { seq, ack } },
      sources: { ...ledger.sources, [observation.sourceId]: source },
    },
  };
}
