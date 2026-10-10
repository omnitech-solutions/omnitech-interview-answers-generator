import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  draftTitle,
  fingerprintOf,
  runSummary,
  saveRefusal,
  textMatchesHash,
} from "./draft";

type Saved = Parameters<typeof saveRefusal>[0];
const briefing = (questions: unknown[]) =>
  ({ answer: null, briefing: { questions } }) as unknown as Saved;

describe("draftTitle", () => {
  it("is the first non-empty line, trimmed, cut to 80 characters", () => {
    expect(draftTitle("\n   \n  Two sum  \nmore")).toBe("Two sum");
    expect(draftTitle("")).toBe("");
    expect(draftTitle("x".repeat(80))).toBe("x".repeat(80));
    expect(draftTitle("x".repeat(81))).toBe(`${"x".repeat(79)}…`);
  });
});

describe("saveRefusal", () => {
  it("needs an answer or a briefing", () => {
    expect(saveRefusal({ answer: null, briefing: null })).toBe(
      "answer-required",
    );
    expect(
      saveRefusal({ answer: {}, briefing: null } as unknown as Saved),
    ).toBe(null);
  });
  it("refuses a briefing with no question, an empty answer or a blank point", () => {
    expect(saveRefusal(briefing([]))).toBe("briefing-incomplete");
    expect(
      saveRefusal(briefing([{ answerMarkdown: "  ", talkingPoints: ["a"] }])),
    ).toBe("briefing-incomplete");
    expect(
      saveRefusal(
        briefing([{ answerMarkdown: "a", talkingPoints: ["a", " "] }]),
      ),
    ).toBe("briefing-incomplete");
    expect(
      saveRefusal(briefing([{ answerMarkdown: "a", talkingPoints: ["a"] }])),
    ).toBe(null);
  });
});

describe("runSummary", () => {
  it("is null without an execution", () => {
    expect(runSummary(null, "t")).toBe(null);
    expect(runSummary("text", "t")).toBe(null);
  });
  it("passes on a zero exit that did not time out, and counts reported tests", () => {
    expect(
      runSummary(
        { exitCode: 0, tests: [{ status: "passed" }, { status: "failed" }] },
        "t",
      ),
    ).toEqual({ ok: true, passed: 1, total: 2, at: "t" });
    expect(runSummary({ exitCode: 0, timedOut: true }, "t")).toEqual({
      ok: false,
      passed: null,
      total: null,
      at: "t",
    });
    expect(runSummary({ exitCode: 1 }, "t")?.ok).toBe(false);
  });
});

describe("fingerprints", () => {
  it("do not depend on key order, and do depend on array order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: "x" }] })).toBe(
      '{"a":[{"c":"x","d":null}],"b":1}',
    );
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("are sha256 hex of the text", () => {
    const sha = createHash("sha256").update("abc").digest("hex");
    expect(fingerprintOf("abc")).toBe(sha);
    expect(textMatchesHash("abc", sha)).toBe(true);
    expect(textMatchesHash("abd", sha)).toBe(false);
  });
});
