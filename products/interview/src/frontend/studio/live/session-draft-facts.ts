// What a session's Workspace draft is made of, read from the session's tasks.
// Pure: the Workspace panel renders these and decides nothing itself.
//
// Two results can exist for one task, and they are never mixed up:
//   written  the solution the session wrote INTO the draft (a published result
//            whose workspace outcome says `published: true`);
//   held     a newer solution the session did not write because the owner had
//            edited the draft (`published: false, conflict`). It lives only on
//            the action; the owner may take it as a suggestion.
// The three code states (generated, tests passed, fully verified) belong to
// the result they were computed for, so each is reported with its own result.
import type { CodeResult } from "./session-results";
import type { ActivityRun } from "./session-runs";
import type { TaskView } from "./session-tasks";

type WrittenResult = {
  // The task revision whose solution the draft was written from.
  taskRevision: number;
  result: CodeResult;
  // The draft revision the session left it at.
  artifactRevision: number | null;
};

export type HeldResult = {
  // The action id: a dismissal is remembered against it.
  runId: string;
  taskRevision: number;
  result: CodeResult;
  // "owner_edited" | "draft_removed" | "draft_exists" (fixed codes).
  reason: string | null;
};

export type DraftFacts = {
  taskRevision: number | null;
  written: WrittenResult | null;
  held: HeldResult | null;
  // The current revision's runs, for progress.
  runs: ActivityRun[];
};

const NO_FACTS: DraftFacts = {
  taskRevision: null,
  written: null,
  held: null,
  runs: [],
};

export function draftFacts(task: TaskView | null): DraftFacts {
  if (!task) return NO_FACTS;
  let written: WrittenResult | null = null;
  let held: HeldResult | null = null;
  // Newest revision first: the newest result decides whether one is held, the
  // newest written one is what the draft was made from.
  for (const revision of [...task.revisions].reverse()) {
    const run = revision.codeRun;
    const result = revision.code;
    if (!run || !result) continue;
    const outcome = result.workspace;
    if (
      !written &&
      (run.state === "published" || run.state === "superseded") &&
      outcome?.published === true
    )
      written = {
        taskRevision: revision.revision,
        result,
        artifactRevision: outcome.artifactRevision,
      };
    // Only the current task revision's solution is offered: an earlier one
    // answers a task that has since changed.
    if (
      !held &&
      !written &&
      revision.revision >= task.currentRevision &&
      run.state === "held-conflict" &&
      outcome?.published === false
    )
      held = {
        runId: run.id,
        taskRevision: revision.revision,
        result,
        reason: outcome.reason,
      };
    // A held result is newer than what was written; nothing older matters.
    if (written) break;
  }
  return {
    taskRevision: task.currentRevision,
    written,
    held,
    runs: task.current.runs,
  };
}

// Whether the owner has changed a draft the session wrote. A session draft
// carries provenance `session:<id>`; the owner's edit of the answer or question
// clears it, and any other edit (notes, stage) moves its draft revision past the
// accepted one. Either way the session will not overwrite it (session-drafts.ts).
export function ownerEdited(
  provenance: {
    proposalId: string;
    draftRevision: number;
    acceptedDraftRevision: number;
  } | null,
  sessionId: string,
): boolean {
  if (provenance === null) return true;
  if (provenance.proposalId !== `session:${sessionId}`) return true;
  return provenance.draftRevision !== provenance.acceptedDraftRevision;
}

// True of every run that reports `runner.available`: packages/code-runner's
// DockerCodeRunner.runAll (--network none, --memory 256m, --cpus 1,
// --pids-limit 128, --read-only, a 20 s test budget, only NO_COLOR in the
// environment, the run's own temporary directory mounted). The session worker
// builds the runner with its defaults (apps/agent-worker main.ts). A result
// from a worker without the runner says the tests did not run instead, and
// nothing else is claimed about the sandbox.
export const RUNNER_NOTE =
  "Tests ran in the code-runner container: no network, a read-only filesystem, 256 MB memory, 1 CPU and a 20 s limit, with no credentials and only this run’s temporary files mounted.";

// Plain sentences for the fixed reason codes behind a false state.
export const STATE_REASON: Record<string, string> = {
  not_generated: "No solution was generated.",
  runner_unavailable: "The test runner was not available, so no tests ran.",
  timed_out: "The tests timed out.",
  exit_nonzero: "The test run ended with an error.",
  no_tests: "The run reported no tests.",
  test_failed: "A test failed.",
  test_skipped: "A test was skipped, and a skipped test is not a pass.",
  constraint_uncovered: "A stated constraint has no test of its own.",
  constraint_shared_test: "Two constraints share one test.",
  syntax_unchecked: "The syntax check did not run.",
  syntax_errors: "The syntax check found problems.",
};

const VERIFICATION_REASONS: ReadonlySet<string> = new Set([
  "constraint_uncovered",
  "constraint_shared_test",
  "syntax_unchecked",
  "syntax_errors",
]);

// The three states, each with the sentence that says exactly what it means.
export type StateLine = {
  key: "generated" | "tests-passed" | "fully-verified";
  label: string;
  on: boolean;
  detail: string;
};

export function stateLines(result: CodeResult): StateLine[] {
  const { states, tests, runner } = result;
  // Why tests passing is still not full verification.
  const verification = states.reasons
    .filter((code) => VERIFICATION_REASONS.has(code))
    .map((code) => STATE_REASON[code])
    .join(" ");
  const counted = tests.total > 0 ? `${tests.passed} of ${tests.total}` : null;
  return [
    {
      key: "generated",
      label: "Generated",
      on: states.generated,
      detail: states.generated
        ? "The session wrote this solution and its tests."
        : "No solution was generated.",
    },
    {
      key: "tests-passed",
      label: states.testsPassed ? "Tests passed" : "Tests not passed",
      on: states.testsPassed,
      detail: !runner.available
        ? "The test runner was not available, so no tests ran."
        : runner.timedOut
          ? "The tests timed out."
          : states.testsPassed
            ? `${counted ?? "All"} generated tests passed.`
            : counted
              ? `${tests.passed} of ${tests.total} generated tests passed.`
              : "No tests were reported.",
    },
    {
      key: "fully-verified",
      label: states.fullyVerified ? "Fully verified" : "Not fully verified",
      on: states.fullyVerified,
      detail: states.fullyVerified
        ? "Every stated constraint has its own passing test. Passing tests do not prove the tests are adequate: review them."
        : !states.testsPassed
          ? "Needs every generated test to pass first."
          : verification || "Passing tests alone are not full verification.",
    },
  ];
}
