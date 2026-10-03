import type { Observation } from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import { VirtualClock } from "./fixture/virtual-clock.js";
import { screenSnapshotMessage, transcriptFinalMessage } from "./messages.js";
import { Outbox } from "./outbox.js";

function transcript(
  outbox: Outbox,
  eventId: string,
  startMs = 0,
  endMs = 1000,
) {
  return transcriptFinalMessage({
    ...outbox.allocate("microphone", "transcript", eventId),
    content: {
      speaker: "microphone",
      source: "microphone",
      text: "synthetic text",
      startMs,
      endMs,
    },
  });
}

describe("outbox", () => {
  it("assigns monotonic sequence per source and derives ids once", () => {
    const outbox = new Outbox(10, new VirtualClock());
    expect(outbox.allocate("microphone", "x")).toMatchObject({
      eventId: "microphone.x.0",
      sequence: 0,
    });
    expect(outbox.allocate("microphone", "x").sequence).toBe(1);
    expect(outbox.allocate("screen", "x").sequence).toBe(0);
    expect(outbox.allocate("microphone", "x", "named").eventId).toBe("named");
  });

  it("returns the same head with the same ids until it is removed", () => {
    const outbox = new Outbox(10, new VirtualClock());
    outbox.enqueue(transcript(outbox, "e1"));
    outbox.enqueue(transcript(outbox, "e2"));
    const first = outbox.head()?.message;
    const again = outbox.head()?.message;
    expect(again).toBe(first);
    expect(outbox.ids().map((id) => id.eventId)).toEqual(["e1", "e2"]);
    outbox.remove("microphone", "e1");
    expect(outbox.head()?.message.eventId).toBe("e2");
    expect(outbox.size).toBe(1);
  });

  it("keeps a screenshot payload with its entry", () => {
    const outbox = new Outbox(10, new VirtualClock());
    const ids = outbox.allocate("screen", "snapshot");
    outbox.enqueue(
      screenSnapshotMessage({
        ...ids,
        content: {
          payloadRef: ids.eventId,
          mediaType: "image/png",
          byteLength: 2,
          windowLabel: "w",
        },
      }),
      new Uint8Array([1, 2]),
    );
    expect(outbox.head()?.payload).toEqual(new Uint8Array([1, 2]));
  });

  it("records overflow as one capture.gap that absorbs further loss", () => {
    const outbox = new Outbox(2, new VirtualClock());
    for (const [index, id] of ["e1", "e2", "e3", "e4"].entries()) {
      outbox.enqueue(transcript(outbox, id, index * 1000, index * 1000 + 500));
    }
    // e1 and e2 were evicted; one gap (queued where the first loss happened,
    // after e3) covers both, and its ids were allocated once.
    expect(outbox.ids().map((id) => id.eventId)).toEqual([
      "e3",
      "microphone.gap.3",
      "e4",
    ]);
    outbox.remove("microphone", "e3");
    const gap = outbox.head()?.message as Observation;
    expect(gap).toMatchObject({
      kind: "capture.gap",
      content: {
        source: "microphone",
        durationMs: 1000,
        reason: "buffer-overflow",
      },
    });
  });

  it("starts a new gap once the earlier one has been tried", () => {
    const outbox = new Outbox(1, new VirtualClock());
    outbox.enqueue(transcript(outbox, "e1"));
    outbox.enqueue(transcript(outbox, "e2")); // evicts e1, gap queued last
    outbox.enqueue(transcript(outbox, "e3")); // evicts e2; gap untried -> absorbed
    expect(
      outbox.ids().filter((id) => id.eventId.includes(".gap.")),
    ).toHaveLength(1);
    // Mark everything attempted by walking heads.
    outbox.remove("microphone", "e3");
    outbox.head(); // the gap is now attempted
    outbox.enqueue(transcript(outbox, "e4"));
    outbox.enqueue(transcript(outbox, "e5")); // evicts e4 -> a second gap
    expect(
      outbox.ids().filter((id) => id.eventId.includes(".gap.")),
    ).toHaveLength(2);
  });

  it("counts a screenshot eviction as a gap of no duration", () => {
    const outbox = new Outbox(1, new VirtualClock());
    for (const n of [0, 1]) {
      const ids = outbox.allocate("screen", "snapshot");
      outbox.enqueue(
        screenSnapshotMessage({
          ...ids,
          content: {
            payloadRef: ids.eventId,
            mediaType: "image/png",
            byteLength: 1,
            windowLabel: `w${n}`,
          },
        }),
        new Uint8Array([1]),
      );
    }
    const gap = outbox.ids().find((id) => id.eventId.includes(".gap."));
    expect(gap?.sourceId).toBe("screen");
  });

  it("never evicts gaps and disconnects, and clears or drops by source", () => {
    const outbox = new Outbox(1, new VirtualClock());
    outbox.enqueue(transcript(outbox, "e1"));
    outbox.removeSource("microphone");
    expect(outbox.size).toBe(0);
    outbox.enqueue(transcript(outbox, "e2"));
    outbox.clear();
    expect(outbox.size).toBe(0);
  });
});
