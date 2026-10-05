// Auto's back-off after a no-question result (D36): a decision table over the
// stricter change threshold and the cooldown, plus reading the newest result.
import { describe, expect, it } from "vitest";
import {
  AUTO_BACKOFF,
  holdAfterNoQuestion,
  newestResultIsNoQuestion,
} from "./auto-backoff";
import type { FrameHash } from "./auto-hash";
import { AUTO_CHANGE_BITS } from "./auto-interval";

// A hash that differs from [0, 0] in exactly n low bits (n <= 32).
const bits = (n: number): FrameHash => [0, n >= 32 ? 0xffffffff : 2 ** n - 1];
const LAST: FrameHash = [0, 0];
const AT = 100_000;
const STRICT = AUTO_BACKOFF.noQuestionChangeBits;
const COOL = AUTO_BACKOFF.noQuestionCooldownMs;

describe("the back-off table", () => {
  it("is stricter than the normal change threshold", () => {
    expect(STRICT).toBeGreaterThan(AUTO_CHANGE_BITS);
  });

  it.each([
    [
      "no-question, small change, soon: held",
      true,
      AUTO_CHANGE_BITS,
      5_000,
      true,
    ],
    [
      "no-question, just under the strict bar: held",
      true,
      STRICT - 1,
      5_000,
      true,
    ],
    [
      "no-question, substantial change: let through",
      true,
      STRICT,
      5_000,
      false,
    ],
    [
      "no-question, small change, cooldown elapsed: let through",
      true,
      AUTO_CHANGE_BITS,
      COOL,
      false,
    ],
    [
      "no-question, small change, just before cooldown: held",
      true,
      AUTO_CHANGE_BITS,
      COOL - 1,
      true,
    ],
    [
      "result was a real question: never held",
      false,
      AUTO_CHANGE_BITS,
      5_000,
      false,
    ],
  ])("%s", (_name, noQuestion, changed, sinceMs, held) => {
    expect(
      holdAfterNoQuestion({
        hash: bits(changed),
        nowMs: AT + sinceMs,
        lastHash: LAST,
        lastAnalyzedAtMs: AT,
        lastResultNoQuestion: noQuestion,
      }),
    ).toBe(held);
  });

  it("holds nothing before Auto has captured a frame", () => {
    expect(
      holdAfterNoQuestion({
        hash: bits(5),
        nowMs: AT,
        lastHash: null,
        lastAnalyzedAtMs: null,
        lastResultNoQuestion: true,
      }),
    ).toBe(false);
  });
});

describe("newestResultIsNoQuestion", () => {
  const action = (
    createdAt: string,
    noQuestion?: true,
    actionKind = "draft-answer",
  ) => ({ actionKind, createdAt, ...(noQuestion ? { noQuestion } : {}) });

  it.each([
    ["no actions", [], false],
    [
      "newest draft is no-question",
      [action("2026-10-05T00:00:01Z"), action("2026-10-05T00:00:09Z", true)],
      true,
    ],
    [
      "a later real task clears it",
      [action("2026-10-05T00:00:01Z", true), action("2026-10-05T00:00:09Z")],
      false,
    ],
    [
      "a later solve-code action is ignored",
      [
        action("2026-10-05T00:00:01Z", true),
        action("2026-10-05T00:00:09Z", undefined, "solve-code"),
      ],
      true,
    ],
  ])("%s", (_name, actions, expected) => {
    expect(newestResultIsNoQuestion(actions)).toBe(expected);
  });
});

describe("the heartbeat after a no-question result", () => {
  it("never re-analyses an identical screen, even once the cooldown has passed", () => {
    const base = {
      hash: LAST,
      lastHash: LAST,
      lastAnalyzedAtMs: AT,
      lastResultNoQuestion: true,
    };
    expect(holdAfterNoQuestion({ ...base, nowMs: AT + COOL * 5 })).toBe(true);
    expect(holdAfterNoQuestion({ ...base, nowMs: AT + 1_000 })).toBe(true);
    // A real question's result never holds; a changed frame ends the hold.
    expect(
      holdAfterNoQuestion({
        ...base,
        nowMs: AT + COOL,
        hash: bits(1),
      }),
    ).toBe(false);
    expect(
      holdAfterNoQuestion({
        ...base,
        nowMs: AT + COOL,
        lastResultNoQuestion: false,
      }),
    ).toBe(false);
  });
});
