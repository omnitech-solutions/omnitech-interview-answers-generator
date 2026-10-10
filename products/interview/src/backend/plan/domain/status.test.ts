import { describe, expect, it } from "vitest";
import { briefingStatus, questionStatus } from "./status";

type Draft = NonNullable<Parameters<typeof questionStatus>[0]>;
const draft = (lastRun: Draft["lastRun"]) => ({ lastRun }) as Draft;

describe("briefingStatus", () => {
  it("says not found, saved, or a draft not saved yet", () => {
    expect(briefingStatus(undefined)).toEqual({
      label: "Briefing not found",
      tone: "warn",
    });
    expect(briefingStatus({ savedRevision: 2 })).toEqual({
      label: "Saved",
      tone: "good",
    });
    expect(briefingStatus({ savedRevision: 0 })).toEqual({
      label: "Draft · not saved yet",
      tone: "warn",
    });
  });
});

describe("questionStatus", () => {
  it("says a missing question and a question never run", () => {
    expect(questionStatus(undefined)).toEqual({
      label: "Question not found",
      tone: "warn",
    });
    expect(questionStatus(draft(null))).toEqual({
      label: "Tests not run yet",
      tone: "neutral",
    });
  });
  it("counts tests when the run reported them: good only when all pass and the run did", () => {
    expect(
      questionStatus(draft({ ok: true, passed: 3, total: 3, at: "t" })),
    ).toEqual({ label: "3 of 3 tests passing", tone: "good" });
    expect(
      questionStatus(draft({ ok: true, passed: 2, total: 3, at: "t" })).tone,
    ).toBe("warn");
    expect(
      questionStatus(draft({ ok: false, passed: 3, total: 3, at: "t" })).tone,
    ).toBe("warn");
  });
  it("falls back to the run's outcome without counts", () => {
    expect(
      questionStatus(draft({ ok: true, passed: null, total: null, at: "t" })),
    ).toEqual({ label: "Tests passing", tone: "good" });
    expect(
      questionStatus(draft({ ok: false, passed: null, total: null, at: "t" })),
    ).toEqual({ label: "Tests failing", tone: "warn" });
  });
});
