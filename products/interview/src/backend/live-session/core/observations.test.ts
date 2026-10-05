import type {
  ControlStatus,
  Observation,
} from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import {
  decideObservation,
  emptyLedger,
  type ObservationLedger,
} from "./index";

const control: ControlStatus = {
  state: "active",
  credentialExpiresAt: "2026-10-03T12:00:00Z",
};

const transcript = (
  eventId: string,
  sequence: number,
  sourceId = "mic-1",
): Observation => ({
  version: 1,
  kind: "transcript.final",
  sourceId,
  eventId,
  occurredAt: "2026-10-03T10:00:00Z",
  sequence,
  content: {
    speaker: "speaker-1",
    text: "synthetic words",
    startMs: 0,
    endMs: 10,
  },
});

const accept = (ledger: ObservationLedger, observation: Observation) => {
  const result = decideObservation(ledger, {
    observation,
    sessionStatus: "active",
    control,
  });
  if (result.decision !== "accepted") throw new Error("expected accepted");
  return result;
};

describe("observation dedup (rule:idempotent-observation)", () => {
  it("accepts a first observation with the next accepted ordinal", () => {
    const first = accept(emptyLedger(), transcript("e1", 0));
    expect(first.seq).toBe(1);
    expect(first.order).toBe("in-order");
    expect(first.ack).toMatchObject({ status: "accepted", eventId: "e1" });
    expect(accept(first.ledger, transcript("e2", 1)).seq).toBe(2);
  });

  it("returns the ORIGINAL acknowledgement unchanged on a resend", () => {
    const first = accept(emptyLedger(), transcript("e1", 0));
    const resend = decideObservation(first.ledger, {
      observation: transcript("e1", 0),
      sessionStatus: "active",
      // A later control state must not leak into the original acknowledgement.
      control: { state: "active", credentialExpiresAt: "2030-01-01T00:00:00Z" },
    });
    expect(resend.decision).toBe("duplicate");
    if (resend.decision !== "duplicate") return;
    expect(resend.ack.original).toEqual(first.ack);
    expect(resend.ledger).toBe(first.ledger);
  });

  it("keys on source AND event id", () => {
    const first = accept(emptyLedger(), transcript("e1", 0, "mic-1"));
    const other = decideObservation(first.ledger, {
      observation: transcript("e1", 0, "app-1"),
      sessionStatus: "active",
      control,
    });
    expect(other.decision).toBe("accepted");
  });

  it("refuses ingest when the session is not capturing, even a resend", () => {
    const first = accept(emptyLedger(), transcript("e1", 0));
    for (const [status, code] of [
      ["paused", "session_paused"],
      ["created", "session_paused"],
      ["ended", "session_ended"],
      ["purging", "session_purging"],
    ] as const) {
      const result = decideObservation(first.ledger, {
        observation: transcript("e1", 0),
        sessionStatus: status,
        control,
      });
      expect(result).toMatchObject({ decision: "refused", code });
    }
  });
});

describe("per-source ordering, late arrival and gaps", () => {
  it("detects a gap, then tolerates the late arrival that fills it", () => {
    let ledger = accept(emptyLedger(), transcript("e0", 0)).ledger;
    const ahead = accept(ledger, transcript("e3", 3));
    expect(ahead.order).toBe("gap-ahead");
    expect(ahead.newGaps).toEqual([
      { sourceId: "mic-1", fromSequence: 1, toSequence: 2 },
    ]);
    expect(ahead.ledger.sources["mic-1"]?.missing).toEqual([1, 2]);
    ledger = ahead.ledger;
    const late = accept(ledger, transcript("e1", 1));
    expect(late.order).toBe("late");
    expect(late.ledger.sources["mic-1"]?.missing).toEqual([2]);
  });

  it("orders each source independently", () => {
    let ledger = accept(emptyLedger(), transcript("a0", 0, "mic-1")).ledger;
    ledger = accept(ledger, transcript("b7", 7, "app-1")).ledger;
    const next = accept(ledger, transcript("a1", 1, "mic-1"));
    expect(next.order).toBe("in-order");
    expect(next.newGaps).toEqual([]);
  });

  it("writes off a missing sequence that falls outside the late window", () => {
    let ledger = accept(emptyLedger(), transcript("e0", 0)).ledger;
    ledger = accept(ledger, transcript("e2", 2)).ledger;
    const jump = decideObservation(ledger, {
      observation: transcript("e30", 30),
      sessionStatus: "active",
      control,
      lateTolerance: 4,
    });
    if (jump.decision !== "accepted") throw new Error("expected accepted");
    expect(jump.ledger.sources["mic-1"]?.lostCount).toBe(24);
    // Sequence 1 and 3..25 fall outside the window. The write-off is data-preserving: the very late event is still accepted.
    const veryLate = accept(jump.ledger, transcript("e1", 1));
    expect(veryLate.order).toBe("out-of-window");
  });

  it("records capture.gap and source.disconnected as state, never as task input", () => {
    let ledger = accept(emptyLedger(), transcript("e0", 0)).ledger;
    const gap = accept(ledger, {
      version: 1,
      kind: "capture.gap",
      sourceId: "mic-1",
      eventId: "g1",
      occurredAt: "2026-10-03T10:00:01Z",
      sequence: 1,
      content: {
        source: "microphone",
        durationMs: 1500,
        reason: "buffer-overflow",
      },
    });
    expect(gap.mayOpenTask).toBe(false);
    expect(gap.ledger.sources["mic-1"]).toMatchObject({
      captureGapCount: 1,
      captureGapMs: 1500,
    });
    const gone = accept(gap.ledger, {
      version: 1,
      kind: "source.disconnected",
      sourceId: "mic-1",
      eventId: "d1",
      occurredAt: "2026-10-03T10:00:02Z",
      sequence: 2,
      content: { source: "microphone", reason: "device-lost" },
    });
    expect(gone.mayOpenTask).toBe(false);
    expect(gone.ledger.sources["mic-1"]).toMatchObject({
      connected: false,
      disconnectReason: "device-lost",
    });
    // A later observation from the same source shows it is back.
    const back = accept(gone.ledger, transcript("e3", 3));
    expect(back.mayOpenTask).toBe(true);
    expect(back.ledger.sources["mic-1"]?.connected).toBe(true);
    ledger = back.ledger;
    expect(ledger.nextSeq).toBe(5);
  });
});
