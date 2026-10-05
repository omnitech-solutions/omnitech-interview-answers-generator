// The Tests drawer's view model: the server's counts, the honesty line, the
// per-test rows with their constraint mapping and failure details, and the
// honest unavailable states.
import { describe, expect, it } from "vitest";
import type { CardCode, CardTest } from "../../shared/task-card-model";
import {
  coversText,
  HONESTY_LINE,
  NO_FAILURE_DETAILS,
  NO_RUNNER,
  NO_TEST_SOURCE,
  testsDrawerView,
} from "./tests-drawer-model";

const constraints = [
  {
    text: "At most 5 calls per second",
    status: "current",
    sinceRevision: 1,
    supersededAtRevision: null,
  },
  {
    text: "Never throws on an unknown client",
    status: "current",
    sinceRevision: 1,
    supersededAtRevision: null,
  },
] as const;

function cardCode(overrides: Partial<CardCode> = {}): CardCode {
  return {
    language: "typescript",
    text: "export const allow = () => true;",
    revision: 1,
    files: [
      {
        id: "solution",
        name: "solution.ts",
        text: "export const allow = () => true;",
      },
      { id: "tests", name: "tests.ts", text: "it('allows', () => {});" },
    ],
    tests: {
      generated: true,
      total: 6,
      passed: 5,
      failed: 1,
      skipped: 0,
      results: [],
    },
    reasons: [],
    syntax: { checked: true, clean: true },
    diagnostics: [],
    repair: { attempted: false, succeeded: false },
    notes: "",
    ...overrides,
  };
}
const testsWith = (results: CardTest[], total = results.length): CardCode =>
  cardCode({
    tests: {
      generated: true,
      total,
      passed: 0,
      failed: 0,
      skipped: 0,
      results,
    },
  });

describe("counts", () => {
  it("are the server's numbers even when the results list is capped", () => {
    const view = testsDrawerView(
      cardCode({
        tests: {
          generated: true,
          total: 80,
          passed: 70,
          failed: 8,
          skipped: 2,
          results: [{ name: "only one kept", status: "passed" }],
        },
      }),
      constraints,
    );
    expect(view.counts).toEqual([
      { id: "generated", label: "Generated", value: "yes" },
      { id: "passed", label: "Passed", value: "70" },
      { id: "failed", label: "Failed", value: "8" },
      { id: "skipped", label: "Skipped", value: "2" },
    ]);
    expect(view.summary).toBe("Tests: 70 of 80 passed");
  });

  it("say Generated: no when the server did not generate tests", () => {
    const code = cardCode();
    const view = testsDrawerView(
      cardCode({
        tests: {
          ...(code.tests as NonNullable<CardCode["tests"]>),
          generated: false,
        },
      }),
      constraints,
    );
    expect(view.counts?.[0]).toEqual({
      id: "generated",
      label: "Generated",
      value: "no",
    });
  });
});

describe("the honesty line", () => {
  it("is always there, and the reasons are added when the code is not fully verified", () => {
    const verified = testsDrawerView(cardCode(), constraints);
    expect(verified.honesty).toBe(HONESTY_LINE);
    expect(verified.notVerified).toBeNull();
    const unverified = testsDrawerView(
      cardCode({
        reasons: [
          "A stated constraint has no test of its own.",
          "A test failed.",
        ],
      }),
      constraints,
    );
    expect(unverified.honesty).toBe(HONESTY_LINE);
    expect(unverified.notVerified).toBe(
      "Not fully verified: A stated constraint has no test of its own. A test failed.",
    );
    expect(
      testsDrawerView(cardCode({ tests: null }), constraints).honesty,
    ).toBe(HONESTY_LINE);
  });
});

describe("rows", () => {
  it("name the constraints a test covers, truncated, and skip an unknown index", () => {
    expect(coversText([0, 1], constraints)).toBe(
      "covers: At most 5 calls per second; Never throws on an unknown client",
    );
    expect(coversText([7], constraints)).toBeNull();
    expect(coversText(undefined, constraints)).toBeNull();
    const long = [{ ...constraints[0], text: "x".repeat(90) }];
    expect(coversText([0], long)).toBe(`covers: ${"x".repeat(59)}…`);
  });

  it("carry the status presentation and, for a failure, the bounded message and a line link", () => {
    const view = testsDrawerView(
      testsWith([
        { name: "allows", status: "passed", covers: [0] },
        {
          name: "rejects",
          status: "failed",
          message: "expected 429",
          location: { editor: "tests", line: 4 },
        },
        { name: "later", status: "skipped" },
      ]),
      constraints,
    );
    if (view.list.kind !== "rows") throw new Error("rows expected");
    const [passed, failed, skipped] = view.list.rows;
    expect(passed?.presentation.icon).toBe("check_circle");
    expect(passed?.covers).toBe("covers: At most 5 calls per second");
    expect(passed?.failure).toBeNull();
    expect(failed?.presentation.word).toBe("Failed");
    expect(failed?.failure).toEqual({
      message: "expected 429",
      link: { editor: "tests", line: 4, label: "Go to line 4 (tests)" },
      unavailable: false,
    });
    expect(skipped?.presentation.icon).toBe("radio_button_unchecked");
  });

  it("say so when a failed test has neither message nor location", () => {
    const view = testsDrawerView(
      testsWith([{ name: "rejects", status: "failed" }]),
      constraints,
    );
    if (view.list.kind !== "rows") throw new Error("rows expected");
    expect(view.list.rows[0]?.failure?.unavailable).toBe(true);
    expect(NO_FAILURE_DETAILS).toBe("Failure details not available");
  });
});

describe("unavailable states", () => {
  it("claims no result when no runner answered", () => {
    const view = testsDrawerView(cardCode({ tests: null }), constraints);
    expect(view.list).toEqual({ kind: "unavailable", text: NO_RUNNER });
    expect(view.counts).toBeNull();
    expect(view.summary).toBe("Tests: no result");
  });

  it("says no test source was published when there is no tests file", () => {
    const view = testsDrawerView(
      cardCode({ files: [{ id: "solution", name: "solution.ts", text: "x" }] }),
      constraints,
    );
    expect(view.source).toEqual({ unavailable: NO_TEST_SOURCE });
  });

  it("gives the reason text when the runner answered with no tests", () => {
    const empty = cardCode({
      tests: {
        generated: true,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        results: [],
      },
      reasons: ["The run reported no tests."],
    });
    expect(testsDrawerView(empty, constraints).list).toEqual({
      kind: "empty",
      text: "The run reported no tests.",
    });
    expect(
      testsDrawerView({ ...empty, reasons: [] }, constraints).list,
    ).toEqual({
      kind: "empty",
      text: "The run reported no tests.",
    });
  });
});
