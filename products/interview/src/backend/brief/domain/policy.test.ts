import { INTERVIEW_BRIEF_BOUNDS } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  carriedNotes,
  isCompleteOrder,
  loosensRecording,
  parkingOrdinal,
} from "./policy";

describe("isCompleteOrder", () => {
  it("accepts exactly the stages, each once, in any order", () => {
    expect(isCompleteOrder(["b", "a"], ["a", "b"])).toBe(true);
    expect(isCompleteOrder([], [])).toBe(true);
  });
  it("refuses a missing, repeated or unknown stage", () => {
    expect(isCompleteOrder(["a"], ["a", "b"])).toBe(false);
    expect(isCompleteOrder(["a", "a"], ["a", "b"])).toBe(false);
    expect(isCompleteOrder(["a", "c"], ["a", "b"])).toBe(false);
    expect(isCompleteOrder(["a", "b", "c"], ["a", "b"])).toBe(false);
  });
});

describe("parkingOrdinal", () => {
  it("is past every held ordinal and every ordinal about to be given", () => {
    expect(parkingOrdinal([1, 2, 7], 3)).toBe(10);
    expect(parkingOrdinal([], 0)).toBe(0);
    expect(parkingOrdinal([-5], 2)).toBe(2);
  });
});

describe("carriedNotes", () => {
  it("has nothing to carry without notes or without a first stage", () => {
    expect(carriedNotes(null, "held", true)).toEqual({
      refused: "nothing-to-carry",
    });
    expect(carriedNotes("notes", null, false)).toEqual({
      refused: "nothing-to-carry",
    });
  });
  it("puts the old notes after what the stage holds", () => {
    expect(carriedNotes("old", "held", true)).toEqual({ moved: "held\n\nold" });
    expect(carriedNotes("old", null, true)).toEqual({ moved: "old" });
  });
  it("refuses past the notes bound, and accepts at it", () => {
    const max = INTERVIEW_BRIEF_BOUNDS.notesChars;
    expect(carriedNotes("x".repeat(max), null, true)).toEqual({
      moved: "x".repeat(max),
    });
    expect(carriedNotes("x".repeat(max), "y", true)).toEqual({
      refused: "limit-reached",
    });
  });
});

describe("loosensRecording", () => {
  const recorded = { origin: "recorded", capturePolicy: "device-only" };
  it("is only a device-only recording asked to become sendable", () => {
    expect(loosensRecording(recorded, "permitted-remote")).toBe(true);
    expect(loosensRecording(recorded, "device-only")).toBe(false);
    expect(loosensRecording(recorded, undefined)).toBe(false);
    expect(
      loosensRecording({ ...recorded, origin: "uploaded" }, "permitted-remote"),
    ).toBe(false);
    expect(
      loosensRecording(
        { origin: "recorded", capturePolicy: "permitted-remote" },
        "permitted-remote",
      ),
    ).toBe(false);
  });
});
