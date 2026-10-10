import { MAX_SESSION_HINTS } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  hintsOfSessions,
  scopeHasSessions,
  scoredRehearsal,
  sessionOfRow,
  statusOfLatestScore,
} from "./scorecard";

describe("hintsOfSessions", () => {
  it("counts nothing and refuses nothing when no session matches", () => {
    expect(hintsOfSessions([], false)).toEqual({ hints: 0 });
    expect(hintsOfSessions([], true)).toEqual({ hints: 0 });
  });
  it("sums the drafts shown in non-strict sessions", () => {
    expect(
      hintsOfSessions(
        [
          { strict: false, shown_draft_count: 2 },
          { strict: false, shown_draft_count: "3" },
        ],
        false,
      ),
    ).toEqual({ hints: 5 });
  });
  it("refuses a strictness claim that disagrees with a session", () => {
    expect(
      hintsOfSessions([{ strict: true, shown_draft_count: 1 }], false),
    ).toEqual({ refused: "rehearsal-strictness-mismatch" });
    expect(
      hintsOfSessions([{ strict: false, shown_draft_count: 1 }], true),
    ).toEqual({ refused: "rehearsal-strictness-mismatch" });
  });
  it("counts no hint for strict sessions and bounds the count", () => {
    expect(
      hintsOfSessions([{ strict: true, shown_draft_count: 9 }], true),
    ).toEqual({ hints: 0 });
    expect(
      hintsOfSessions(
        [{ strict: false, shown_draft_count: MAX_SESSION_HINTS + 50 }],
        false,
      ),
    ).toEqual({ hints: MAX_SESSION_HINTS });
    expect(
      hintsOfSessions([{ strict: false, shown_draft_count: -4 }], false),
    ).toEqual({ hints: 0 });
  });
});

describe("scoredRehearsal", () => {
  it("removes repeated checks and reveals and stores hints apart from reveals", () => {
    const input = { format: "x", checks: ["a", "a", "b"], reveals: ["r", "r"] };
    const without = scoredRehearsal(input, undefined);
    expect(without.value).toEqual({
      format: "x",
      checks: ["a", "b"],
      reveals: ["r"],
    });
    const withHints = scoredRehearsal(input, 2);
    expect(withHints.value).toEqual({ ...without.value, sessionHints: 2 });
    expect(withHints.score).toBeLessThanOrEqual(without.score);
    expect(scoredRehearsal(input, 0).score).toBe(without.score);
  });
});

describe("statusOfLatestScore", () => {
  it("reports no rehearsal, a good score from 75 and a warning below", () => {
    expect(statusOfLatestScore(undefined)).toEqual({
      label: "Not rehearsed yet",
      tone: "neutral",
    });
    expect(statusOfLatestScore({ score: "75" })).toEqual({
      label: "Last score 75",
      tone: "good",
    });
    expect(statusOfLatestScore({ score: 74 })).toEqual({
      label: "Last score 74",
      tone: "warn",
    });
  });
});

describe("scopeHasSessions and sessionOfRow", () => {
  it("needs uuid tenant and actor", () => {
    const uuid = "0b0e7a52-7d3c-4c1e-9c57-3f1f6f0f9a11";
    expect(scopeHasSessions({ tenantId: uuid, actorId: uuid })).toBe(true);
    expect(scopeHasSessions({ tenantId: "local", actorId: uuid })).toBe(false);
    expect(scopeHasSessions({ tenantId: uuid, actorId: "me" })).toBe(false);
  });
  it("takes id and score from the row's columns over the stored value", () => {
    expect(
      sessionOfRow({ id: 7, score: "80", value: { id: "x", format: "f" } }),
    ).toEqual({ id: "7", score: 80, format: "f" });
  });
});
