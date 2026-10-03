// The coding path (plan #2 D6): the second action kind of a coding task. A
// published prose draft that named the task a coding challenge makes this action
// owed for the same task revision; it runs on the SAME fenced dispatch skeleton
// (beginDispatch: record, standing check, profile), then
//   1. one structured gateway call for the solution (closed schema, no tools);
//   2. the tests, run through the host's CodeRunner with empty stdin, plus a
//      syntax check when the runner offers one;
//   3. when the tests fail, ONE direct repair attempt: a second gateway call
//      that carries only the failing report's test names and statuses;
//   4. the three distinct states (code-states.ts) derived from what the runner
//      actually reported;
//   5. a fenced publish whose effect writes the session-owned Workspace draft
//      in the same transaction, behind the expected-revision check
//      (session-drafts.ts).
// A runner that is absent or unavailable never blocks the solution: it
// publishes as generated with testsPassed false and the reason
// `runner_unavailable` - it never claims tests passed. The prose draft never
// waits for any of this: it is a separate action that dispatches first, and at
// most one model call per session is in flight.
import { runResultSchema } from "@omnitech/interview-contracts";
import type { CodingBrief } from "./assist-stage.js";
import { type CodeStates, codeStates, type RunFacts } from "./code-states.js";
import {
  type CodingSolution,
  type CodingStage,
  type FailedAttempt,
  type PriorSolution,
} from "./coding-stage.js";
import type { Task } from "./core/index.js";
import {
  beginDispatch,
  type Dispatch,
  type DispatchDeps,
} from "./session-dispatch.js";
import {
  buildSessionDraft,
  sessionDraftEffect,
  type WorkspaceOutcome,
} from "./session-drafts.js";
import {
  capturedFor,
  type CodingCandidate,
  noteSolution,
  type SessionCodeRunner,
  type SessionRun,
} from "./session-run.js";

// The report kept on the action: names and statuses only, never output.
const MAX_STORED_TESTS = 50;

type Generated =
  | { kind: "solution"; solution: CodingSolution }
  | { kind: "invalid"; violations: readonly string[] }
  // The dispatch is over (refused, failed, stopped); it traced its own outcome.
  | { kind: "over" };

type Verification = {
  run: RunFacts;
  durationMs: number | null;
  syntax: { clean: boolean } | null;
};

// One generation: prepare the prompt, make the call, validate the output.
async function generate(
  d: Dispatch,
  stage: CodingStage,
  input: {
    candidate: CodingCandidate;
    task: Task;
    previous: PriorSolution | null;
    failed: FailedAttempt | null;
  },
  tag: string,
): Promise<Generated> {
  const { run, task } = d;
  const prepared = stage.prepare({
    taskId: task.taskId,
    revision: task.revision,
    captured: capturedFor(run, task),
    brief: input.candidate.brief,
    previous: input.previous,
    failed: input.failed,
    deviceOnly: d.deviceOnly,
  });
  if (!prepared.ok) {
    d.noteBytesIn(prepared.byteCount);
    await d.refuse("prompt_too_large", "prompt_too_large");
    return { kind: "over" };
  }
  const called = await d.call(prepared.prompt, tag);
  if (!called.ok) return { kind: "over" };
  const checked = stage.validate(called.result, input.candidate.brief);
  if (!checked.ok) return { kind: "invalid", violations: checked.violations };
  return { kind: "solution", solution: checked.solution };
}

// [SAFETY] Runs the model's code and tests ONLY through the injected runner
// (the sandboxed CodeRunner); nothing the model wrote is evaluated here. A
// runner that throws is treated as unavailable: the error is never read.
async function verify(
  runner: SessionCodeRunner | undefined,
  solution: CodingSolution,
): Promise<Verification> {
  if (!runner) return { run: null, durationMs: null, syntax: null };
  let run: RunFacts = null;
  let durationMs: number | null = null;
  try {
    const result = runResultSchema.parse(
      await runner.runAll({
        language: solution.language,
        code: solution.code,
        usageCode: solution.usageCode ?? "",
        testCode: solution.testCode,
        stdin: "",
      }),
    );
    run = {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      tests: (result.tests ?? []).map(({ name, status }) => ({ name, status })),
    };
    durationMs = result.durationMs;
  } catch {
    return { run: null, durationMs: null, syntax: null };
  }
  let syntax: Verification["syntax"] = null;
  if (runner.checkSyntax) {
    try {
      const checked = runResultSchema.parse(
        await runner.checkSyntax({
          language: solution.language,
          code: solution.code,
        }),
      );
      syntax = {
        clean:
          checked.exitCode === 0 &&
          !checked.timedOut &&
          (checked.diagnostics ?? []).length === 0,
      };
    } catch {
      syntax = null;
    }
  }
  return { run, durationMs, syntax };
}

const statesOf = (
  solution: CodingSolution,
  brief: CodingBrief,
  verification: Verification,
): CodeStates =>
  codeStates({
    solutionValid: true,
    run: verification.run,
    syntax: verification.syntax,
    constraintCount: brief.constraints.length,
    coverage: solution.coverage,
  });

export async function dispatchCoding(
  run: SessionRun,
  pending: { task: Task; candidate: CodingCandidate },
  deps: DispatchDeps,
): Promise<void> {
  const { task, candidate } = pending;
  const stage = deps.policy.coding;
  const d = await beginDispatch(run, task, deps, stage);
  if (d === null) return;

  // [SAFETY] The test runner is the host's, and device-only means nothing leaves
  // the person's device: without the host's declaration that the runner is
  // device-local, a device-only session never reaches it. (A stage with no
  // device profile was already refused above as stage_unlisted: both checks
  // hold independently.)
  if (d.deviceOnly && deps.runnerDeviceLocal !== true) {
    await d.refuse("runner_not_device_local", "runner-not-device-local");
    return;
  }

  // The earlier solution is only context for a LATER revision.
  const earlier = run.solutions.get(task.taskId);
  const previous = earlier && earlier.revision < task.revision ? earlier : null;
  const brief = candidate.brief;

  // 1. The first attempt. An output that violates the closed schema publishes
  // nothing (rule:structured-field-decisions).
  const first = await generate(
    d,
    stage,
    { candidate, task, previous, failed: null },
    "",
  );
  if (first.kind === "over") return;
  if (first.kind === "invalid") {
    await d.refuse("invalid_output", "invalid-output", {
      violationCount: first.violations.length,
      firstViolation: first.violations[0] ?? "$",
    });
    return;
  }
  let solution = first.solution;

  // A revision a newer one replaced is not worth testing: its result could
  // never publish. (The fenced publish below remains the authority.)
  const isCurrent = () =>
    run.tasks.tasks[task.taskId]?.revision === task.revision;
  if (!isCurrent()) {
    await d.refuse("revision_stale", "revision_stale");
    return;
  }

  // 2. The tests (and syntax check) through the host's runner.
  let verification = await verify(deps.codeRunner, solution);
  if (d.stopped()) return;
  let states = statesOf(solution, brief, verification);

  // 3. ONE direct repair attempt when the tests ran and did not pass; the
  // second call carries only the failing report's names and statuses. A repair
  // that does not validate keeps the first attempt.
  let repairAttempted = false;
  let repairSucceeded = false;
  if (verification.run !== null && !states.testsPassed) {
    repairAttempted = true;
    const second = await generate(
      d,
      stage,
      {
        candidate,
        task,
        previous,
        failed: {
          code: solution.code,
          testCode: solution.testCode,
          exitCode: verification.run.exitCode,
          timedOut: verification.run.timedOut,
          tests: verification.run.tests,
        },
      },
      ":repair",
    );
    if (second.kind === "over") return;
    if (second.kind === "solution") {
      const repairedVerification = await verify(
        deps.codeRunner,
        second.solution,
      );
      if (d.stopped()) return;
      solution = second.solution;
      verification = repairedVerification;
      states = statesOf(solution, brief, verification);
      repairSucceeded = states.testsPassed;
    }
  }

  // 4. The Workspace draft, validated BEFORE the publish so a draft that would
  // not fit the answer shape is an invalid output, never a rolled-back publish.
  const draft = buildSessionDraft({ brief, solution, states });
  if (!draft.ok) {
    await d.refuse("invalid_output", "invalid-output", {
      violationCount: 1,
      firstViolation: "draft:invalid",
    });
    return;
  }

  // 5. Publish: the result and the draft write commit together, or neither.
  const tests = verification.run?.tests ?? [];
  const count = (status: string) =>
    tests.filter((test) => test.status === status).length;
  let workspace: WorkspaceOutcome | undefined;
  const inner = sessionDraftEffect({ draft: draft.draft });
  const published = await d.publish(
    {
      version: 1,
      stage: stage.actionKind,
      language: solution.language,
      code: solution.code,
      usageCode: solution.usageCode ?? "",
      testCode: solution.testCode,
      coverage: solution.coverage,
      // Only the validated enum is recorded here; the escalation decision is
      // made from it by the processor, never from anything the model said.
      escalation: solution.escalation,
      notes: solution.notes,
      // Three separate states, never collapsed (reasons are codes).
      states,
      tests: {
        total: tests.length,
        passed: count("passed"),
        failed: count("failed"),
        skipped: count("skipped"),
        results: tests.slice(0, MAX_STORED_TESTS),
      },
      run: {
        available: verification.run !== null,
        exitCode: verification.run?.exitCode ?? null,
        timedOut: verification.run?.timedOut ?? false,
        durationMs: verification.durationMs,
      },
      syntax: {
        checked: verification.syntax !== null,
        clean: verification.syntax?.clean ?? null,
      },
      repair: { attempted: repairAttempted, succeeded: repairSucceeded },
      // The earlier solution this revision replaces, when one existed: it was
      // built for constraints that have since changed.
      replacesRevision: previous?.revision ?? null,
      meta: {
        profileId: d.profileId,
        processingPolicy: d.processingPolicy,
        constraintCount: brief.constraints.length,
      },
    },
    {
      effect: async (context) => {
        const merged = await inner(context);
        workspace = merged?.["workspace"] as WorkspaceOutcome | undefined;
        return merged;
      },
      detail: {
        generated: states.generated,
        testsPassed: states.testsPassed,
        fullyVerified: states.fullyVerified,
        reasons: states.reasons.length,
        tests: tests.length,
        repairAttempted,
      },
    },
  );
  if (!published) return;
  noteSolution(run, task.taskId, {
    revision: task.revision,
    language: solution.language,
    code: solution.code,
    testCode: solution.testCode,
  });
  d.trace("coding.workspace", workspace?.published ? "written" : "held", {
    conflict: workspace?.published === false,
  });
}
