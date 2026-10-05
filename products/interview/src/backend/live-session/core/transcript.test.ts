// The merge gap is a fact of the transcript: it decides what one utterance is,
// so a changed gap changes which question a task is named after.
import { describe, expect, it } from "vitest";
import { coalesceSegments, MERGE_GAP_MS, type Segment } from "./transcript";

const segment = (
  eventId: string,
  startMs: number,
  endMs: number,
  speaker = "interviewer",
): Segment => ({
  eventId,
  sourceId: "application-audio",
  speaker,
  startMs,
  endMs,
  text: eventId,
  seq: 1,
  supersededBy: null,
  originId: eventId,
});
const never = () => false;

describe("coalesceSegments", () => {
  it("merges same-speaker segments one merge gap apart", () => {
    const utterances = coalesceSegments(
      [segment("a", 0, 1_000), segment("b", 1_000 + MERGE_GAP_MS, 4_000)],
      never,
    );
    expect(utterances.map((u) => u.segmentIds)).toEqual([["a", "b"]]);
  });

  it("splits same-speaker segments 1600 ms apart into two utterances", () => {
    const utterances = coalesceSegments(
      [segment("a", 0, 1_000), segment("b", 2_600, 4_000)],
      never,
    );
    expect(utterances.map((u) => u.segmentIds)).toEqual([["a"], ["b"]]);
  });

  it("pins the merge gap at 1500 ms", () => {
    expect(MERGE_GAP_MS).toBe(1_500);
  });

  it("never merges different speakers", () => {
    const utterances = coalesceSegments(
      [segment("a", 0, 1_000), segment("b", 1_200, 2_000, "candidate")],
      never,
    );
    expect(utterances).toHaveLength(2);
  });
});
