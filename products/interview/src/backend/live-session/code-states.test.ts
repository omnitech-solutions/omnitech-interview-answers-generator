import { describe, expect, it } from "vitest";
import { type CodeFacts, codeStates } from "./code-states.js";

const passing = (...names: string[]) => ({
  exitCode: 0,
  timedOut: false,
  tests: names.map((name) => ({ name, status: "passed" as const })),
});
const base: CodeFacts = {
  solutionValid: true,
  run: passing("window", "burst"),
  syntax: { clean: true },
  constraintCount: 2,
  coverage: [
    { constraintIndex: 0, testName: "window" },
    { constraintIndex: 1, testName: "burst" },
  ],
};

describe("codeStates", () => {
  it("is fully verified only when tests passed, every constraint is covered and syntax is clean", () => {
    expect(codeStates(base)).toEqual({
      generated: true,
      testsPassed: true,
      fullyVerified: true,
      reasons: [],
    });
  });

  it("keeps tests passed apart from fully verified when a constraint has no named test", () => {
    const states = codeStates({
      ...base,
      coverage: [{ constraintIndex: 0, testName: "window" }],
    });
    expect(states.generated).toBe(true);
    expect(states.testsPassed).toBe(true);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toEqual(["constraint_uncovered"]);
  });

  it("review finding 9: one passing test mapped to every constraint is not full verification", () => {
    // A single empty test named "works" that the solution claims for both
    // constraints must not verify either of them separately.
    const states = codeStates({
      ...base,
      run: passing("works"),
      coverage: [
        { constraintIndex: 0, testName: "works" },
        { constraintIndex: 1, testName: "works" },
      ],
    });
    expect(states.testsPassed).toBe(true);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toEqual(["constraint_shared_test"]);
  });

  it("finds a distinct test per constraint even when a constraint lists several candidates", () => {
    const states = codeStates({
      ...base,
      run: passing("window", "burst"),
      coverage: [
        { constraintIndex: 0, testName: "window" },
        { constraintIndex: 0, testName: "burst" },
        { constraintIndex: 1, testName: "window" },
      ],
    });
    expect(states.fullyVerified).toBe(true);
  });

  it("does not count coverage by a test name the runner never reported", () => {
    const states = codeStates({
      ...base,
      coverage: [
        { constraintIndex: 0, testName: "window" },
        { constraintIndex: 1, testName: "invented" },
      ],
    });
    expect(states.testsPassed).toBe(true);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toContain("constraint_uncovered");
  });

  it("does not count coverage by a test name that also failed", () => {
    const states = codeStates({
      ...base,
      run: {
        exitCode: 1,
        timedOut: false,
        tests: [
          { name: "window", status: "passed" },
          { name: "burst", status: "passed" },
          { name: "burst", status: "failed" },
        ],
      },
    });
    expect(states.testsPassed).toBe(false);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toEqual(
      expect.arrayContaining(["exit_nonzero", "test_failed"]),
    );
  });

  it("is generated but not tested when a test fails", () => {
    const states = codeStates({
      ...base,
      run: {
        exitCode: 1,
        timedOut: false,
        tests: [
          { name: "window", status: "passed" },
          { name: "burst", status: "failed" },
        ],
      },
    });
    expect(states).toMatchObject({
      generated: true,
      testsPassed: false,
      fullyVerified: false,
    });
    expect(states.reasons).toEqual(["exit_nonzero", "test_failed"]);
  });

  it("is not passed on a timeout, even with exit code 0 and passing tests", () => {
    const states = codeStates({
      ...base,
      run: { ...passing("window", "burst"), timedOut: true },
    });
    expect(states.testsPassed).toBe(false);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toEqual(["timed_out"]);
  });

  it("is not passed when the runner reported zero tests", () => {
    const states = codeStates({ ...base, run: passing() });
    expect(states.testsPassed).toBe(false);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toContain("no_tests");
  });

  it("does not treat a skipped test as a pass", () => {
    const states = codeStates({
      ...base,
      run: {
        exitCode: 0,
        timedOut: false,
        tests: [
          { name: "window", status: "passed" },
          { name: "burst", status: "skipped" },
        ],
      },
    });
    expect(states.testsPassed).toBe(false);
    expect(states.reasons).toEqual(["test_skipped"]);
  });

  it("never claims tests passed without a runner", () => {
    const states = codeStates({ ...base, run: null });
    expect(states).toEqual({
      generated: true,
      testsPassed: false,
      fullyVerified: false,
      reasons: ["runner_unavailable"],
    });
  });

  it("withholds full verification when the syntax check did not run or found errors", () => {
    const unchecked = codeStates({ ...base, syntax: null });
    expect(unchecked.testsPassed).toBe(true);
    expect(unchecked.fullyVerified).toBe(false);
    expect(unchecked.reasons).toEqual(["syntax_unchecked"]);
    const dirty = codeStates({ ...base, syntax: { clean: false } });
    expect(dirty.testsPassed).toBe(true);
    expect(dirty.fullyVerified).toBe(false);
    expect(dirty.reasons).toEqual(["syntax_errors"]);
  });

  it("is not generated when the solution did not validate", () => {
    const states = codeStates({ ...base, solutionValid: false });
    expect(states.generated).toBe(false);
    expect(states.testsPassed).toBe(false);
    expect(states.fullyVerified).toBe(false);
    expect(states.reasons).toContain("not_generated");
  });

  it("treats a task with no stated constraint as vacuously covered", () => {
    const states = codeStates({ ...base, constraintCount: 0, coverage: [] });
    expect(states.fullyVerified).toBe(true);
  });
});
