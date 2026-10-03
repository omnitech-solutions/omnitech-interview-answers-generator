// The three DISTINCT states of coding assistance (ADR-0011, plan #2 D6), derived
// from observed facts and never collapsed into one "verified" flag:
//
//   generated      a structured solution was validated against the closed
//                  schema and is being published;
//   testsPassed    the runner exited 0, did not time out, reported at least one
//                  test and EVERY reported test passed (a skipped test is not a
//                  pass);
//   fullyVerified  testsPassed AND every stated constraint of the task revision
//                  is covered by a NAMED test that passed AND the syntax check
//                  was clean.
//
// Tests can pass while fullyVerified is false (a constraint no test names, a
// syntax check that was not run). `reasons` is a code list that says why a state
// is false; it never carries a model-controlled string.
import type { TestResult } from "@omnitech/interview-contracts";

export const CODE_STATE_REASONS = [
  "not_generated",
  "runner_unavailable",
  "timed_out",
  "exit_nonzero",
  "no_tests",
  "test_failed",
  "test_skipped",
  "constraint_uncovered",
  "syntax_unchecked",
  "syntax_errors",
] as const;
export type CodeStateReason = (typeof CODE_STATE_REASONS)[number];

export type CodeStates = {
  generated: boolean;
  testsPassed: boolean;
  fullyVerified: boolean;
  reasons: CodeStateReason[];
};

// What the test runner reported; null when no runner answered.
export type RunFacts = {
  exitCode: number | null;
  timedOut: boolean;
  tests: readonly Pick<TestResult, "name" | "status">[];
} | null;

export type CodeFacts = {
  // The structured solution passed validation.
  solutionValid: boolean;
  run: RunFacts;
  // null: the syntax check was not run (no checker, or it did not answer).
  syntax: { clean: boolean } | null;
  // The task revision's CURRENTLY stated constraints, by count, and which test
  // the solution names for each.
  constraintCount: number;
  coverage: readonly { constraintIndex: number; testName: string }[];
};

export function codeStates(facts: CodeFacts): CodeStates {
  const reasons: CodeStateReason[] = [];
  const generated = facts.solutionValid;
  if (!generated) reasons.push("not_generated");

  // [STRATEGY] Tests passed is the runner's own verdict, read strictly: any
  // doubt (no runner, a timeout, a non-zero exit, no tests, a test that did not
  // pass) leaves it false.
  const { run } = facts;
  let testsPassed = false;
  if (run === null) reasons.push("runner_unavailable");
  else {
    if (run.timedOut) reasons.push("timed_out");
    if (run.exitCode !== 0 && !run.timedOut) reasons.push("exit_nonzero");
    if (run.tests.length === 0) reasons.push("no_tests");
    if (run.tests.some((test) => test.status === "failed"))
      reasons.push("test_failed");
    if (run.tests.some((test) => test.status === "skipped"))
      reasons.push("test_skipped");
    testsPassed =
      generated &&
      run.exitCode === 0 &&
      !run.timedOut &&
      run.tests.length > 0 &&
      run.tests.every((test) => test.status === "passed");
  }

  // [DOMAIN] A constraint is covered when some coverage entry names a test and
  // every reported test of that name passed. A name the runner never reported is
  // not coverage.
  const names = new Map<string, boolean>();
  for (const test of run?.tests ?? [])
    names.set(
      test.name,
      (names.get(test.name) ?? true) && test.status === "passed",
    );
  const covered = (index: number) =>
    facts.coverage.some(
      (entry) =>
        entry.constraintIndex === index && names.get(entry.testName) === true,
    );
  let allCovered = true;
  for (let index = 0; index < facts.constraintCount; index += 1)
    if (!covered(index)) allCovered = false;
  if (testsPassed && !allCovered) reasons.push("constraint_uncovered");

  if (facts.syntax === null) reasons.push("syntax_unchecked");
  else if (!facts.syntax.clean) reasons.push("syntax_errors");

  const fullyVerified =
    testsPassed && allCovered && facts.syntax !== null && facts.syntax.clean;
  return { generated, testsPassed, fullyVerified, reasons };
}
