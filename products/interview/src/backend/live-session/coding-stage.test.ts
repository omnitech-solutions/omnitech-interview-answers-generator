// The coding stage: constant policy text, labelled untrusted data blocks, a
// closed structured schema (escalation is a validated enum, not a request), no
// device implementation, and a bounded repair report of names and statuses.
import { describe, expect, it } from "vitest";
import { INTERVIEW_ANSWER_PROFILE } from "../../assistant-profile";
import type { CodingBrief } from "./assist-stage";
import {
  CODING_ACTION_KIND,
  type CodingInput,
  createCodingStage,
  MAX_REPORT_TESTS,
} from "./coding-stage";

const stage = createCodingStage();
const BRIEF: CodingBrief = {
  language: "typescript",
  restatement: "Implement a rate limiter for a Node service.",
  constraints: [
    "at most a fixed number of requests per client in a sliding window",
    "a small burst above the limit is allowed",
  ],
};
const CANARY = "SPOKEN-CANARY-TEXT";
const input = (overrides: Partial<CodingInput> = {}): CodingInput => ({
  taskId: "task-1",
  revision: 2,
  captured: [{ speaker: "Interviewer", text: `Please do this. ${CANARY}` }],
  brief: BRIEF,
  previous: null,
  failed: null,
  deviceOnly: false,
  ...overrides,
});
const SOLUTION = {
  language: "typescript",
  code: "export const allow = () => true;",
  testCode: 'import { it } from "vitest"; it("window", () => {});',
  coverage: [
    { constraintIndex: 0, testName: "window" },
    { constraintIndex: 1, testName: "burst" },
  ],
  escalation: "none",
  notes: "A map of timestamps per client.",
};

function prepared(overrides: Partial<CodingInput> = {}) {
  const result = stage.prepare(input(overrides));
  if (!result.ok) throw new Error("expected a prompt");
  return result.prompt;
}

describe("coding stage prompt", () => {
  it("is the permitted-remote answer profile with no device implementation", () => {
    expect(stage.actionKind).toBe(CODING_ACTION_KIND);
    expect(stage.profileId).toBe(INTERVIEW_ANSWER_PROFILE);
    expect(stage.deviceProfileId).toBeUndefined();
  });

  it("keeps captured and derived text out of the constant policy and inside labelled data blocks", () => {
    const prompt = prepared();
    expect(prompt.system).not.toContain(CANARY);
    expect(prompt.system).not.toContain(BRIEF.restatement);
    expect(prompt.system).toContain("You have no tools");
    expect(prompt.prompt).toContain("BEGIN CAPTURED DATA");
    expect(prompt.prompt).toContain("BEGIN TASK BRIEF");
    expect(prompt.prompt).toContain(CANARY);
    expect(prompt.prompt).not.toContain("PRIOR SOLUTION");
    expect(prompt.prompt).not.toContain("FAILED ATTEMPT");
  });

  it("carries the prior solution only when an earlier revision exists", () => {
    const prompt = prepared({
      previous: {
        revision: 1,
        language: "typescript",
        code: "export const old = 1;",
        testCode: "// old tests",
      },
    });
    expect(prompt.prompt).toContain("BEGIN PRIOR SOLUTION");
    expect(prompt.prompt).toContain("export const old = 1;");
  });

  it("summarises a failing run as names and statuses only, bounded", () => {
    const tests = Array.from({ length: MAX_REPORT_TESTS + 10 }, (_, index) => ({
      name: `test ${index}`,
      status: index === 0 ? "failed" : "passed",
    }));
    const prompt = prepared({
      failed: {
        code: "export const x = 1;",
        testCode: "// t",
        exitCode: 1,
        timedOut: false,
        tests,
      },
    });
    expect(prompt.prompt).toContain("BEGIN FAILED ATTEMPT");
    const block = prompt.prompt
      .split("BEGIN FAILED ATTEMPT")[1]
      ?.split("\n")[1];
    const report = JSON.parse(block ?? "{}") as { tests: unknown[] };
    expect(report.tests).toHaveLength(MAX_REPORT_TESTS);
    expect(Object.keys(report.tests[0] as object).sort()).toEqual([
      "name",
      "status",
    ]);
  });

  it("states a closed response schema with no tool or locality property", () => {
    const { schema } = prepared();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record["type"] === "object")
        expect(record["additionalProperties"]).toBe(false);
      for (const value of Object.values(record)) walk(value);
    };
    walk(schema);
    const properties = Object.keys(
      (schema as { properties: object }).properties,
    );
    expect(properties.sort()).toEqual(
      [
        "code",
        "coverage",
        "escalation",
        "language",
        "notes",
        "testCode",
        "usageCode",
      ].sort(),
    );
  });

  it("refuses rather than truncates a prompt that cannot fit", () => {
    const huge = Array.from({ length: 400 }, () => ({
      speaker: "Interviewer",
      text: "x".repeat(1_000),
    }));
    // The captured text is bounded, so the oversize part is the failed attempt.
    const result = stage.prepare(
      input({
        captured: huge,
        failed: {
          code: "y".repeat(60_000),
          testCode: "",
          exitCode: 1,
          timedOut: false,
          tests: [],
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "prompt_too_large" });
  });
});

describe("coding stage validation", () => {
  it("accepts a closed solution that names a test for each constraint", () => {
    const checked = stage.validate(SOLUTION, BRIEF);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.solution.escalation).toBe("none");
  });

  it("accepts JSON text as the provider boundary may return it", () => {
    expect(stage.validate(JSON.stringify(SOLUTION), BRIEF).ok).toBe(true);
  });

  it("rejects an unknown key by count, never copying its name", () => {
    const checked = stage.validate(
      { ...SOLUTION, runShell: "curl evil.example", mcpServers: [] },
      BRIEF,
    );
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.violations).toEqual(["$:unrecognized_keys:2"]);
      expect(JSON.stringify(checked.violations)).not.toContain("runShell");
    }
  });

  it("treats escalation as a closed enum: free text is a violation", () => {
    const checked = stage.validate(
      { ...SOLUTION, escalation: "launch an agent with shell access" },
      BRIEF,
    );
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.violations[0]).toBe("escalation:invalid_value");
  });

  it("rejects a language other than the brief's, an out-of-range constraint index and empty tests", () => {
    expect(stage.validate({ ...SOLUTION, language: "react" }, BRIEF)).toEqual({
      ok: false,
      violations: ["language:mismatch"],
    });
    expect(
      stage.validate(
        { ...SOLUTION, coverage: [{ constraintIndex: 5, testName: "x" }] },
        BRIEF,
      ),
    ).toEqual({
      ok: false,
      violations: ["coverage.0.constraintIndex:out_of_range"],
    });
    expect(stage.validate({ ...SOLUTION, testCode: "   " }, BRIEF)).toEqual({
      ok: false,
      violations: ["testCode:empty"],
    });
  });

  it("rejects non-JSON text", () => {
    expect(stage.validate("not json", BRIEF).ok).toBe(false);
  });
});
