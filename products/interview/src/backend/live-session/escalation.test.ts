// Escalation to an agent job (plan #2 D7): a job exists ONLY when the validated
// structured field asks for it ("repository-navigation", or "iterative-repair"
// after one direct repair attempt failed its tests) in a permitted-remote
// session; the action naming the reserved id commits before the job exists; the
// job is the owner's private job carrying a typed profile and a payload
// reference only; pause cancels it; device-only, an enum of "none", free text
// and an output outside the closed schema never create one. The job repository
// is the real PostgresAgentJobRepository on the disposable database.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { INTERVIEW_SESSION_DEVICE_PROFILE } from "../../assistant-profile";
import {
  BURSTS,
  fakeRunner,
  NARRATE_1,
  QUESTION,
  runResult,
  scriptedEngine,
  solutionFor,
} from "./coding-fixture";
import { createCodingStage } from "./coding-stage";
import { type AgentEscalationPort, decideEscalation } from "./escalation";
import type { SessionJobRequest } from "./fenced-writes";
import { createInterviewSessionPolicy } from "./interview-policy";
import {
  type AnyRow,
  type Fixture,
  startFixture,
} from "./live-session-fixture";
import {
  buildProcessor,
  collectTraces,
  type FakeEngine,
  settle,
  startSessionFor,
} from "./processor-fixture";
import { ActiveSessionRepository } from "./repository";
import type { SessionCodeRunner } from "./session-run";

describe("decideEscalation", () => {
  const base = {
    stageEscalation: "none" as const,
    directRepairFailed: false,
    processingPolicy: "permitted-remote" as const,
    hasRunner: true,
  };

  it("fires for repository-navigation in a permitted-remote session, with or without a repair", () => {
    expect(
      decideEscalation({ ...base, stageEscalation: "repository-navigation" }),
    ).toBe("repository-navigation");
    expect(
      decideEscalation({
        ...base,
        stageEscalation: "repository-navigation",
        hasRunner: false,
      }),
    ).toBe("repository-navigation");
  });

  it("fires for iterative-repair only after a direct repair attempt failed its tests, with a runner", () => {
    const iterative = { ...base, stageEscalation: "iterative-repair" as const };
    expect(decideEscalation(iterative)).toBe("none");
    expect(decideEscalation({ ...iterative, directRepairFailed: true })).toBe(
      "iterative-repair",
    );
    expect(
      decideEscalation({
        ...iterative,
        directRepairFailed: true,
        hasRunner: false,
      }),
    ).toBe("none");
  });

  it("never fires for none, whatever else holds", () => {
    expect(decideEscalation({ ...base, directRepairFailed: true })).toBe(
      "none",
    );
  });

  it("never fires in device-only", () => {
    for (const stageEscalation of [
      "repository-navigation",
      "iterative-repair",
    ] as const)
      expect(
        decideEscalation({
          ...base,
          stageEscalation,
          directRepairFailed: true,
          processingPolicy: "device-only",
        }),
      ).toBe("none");
  });
});

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

// A typed, versioned, bounded profile the host would supply: read-only, no
// approval prompts, no extra directories, no web search, no tools.
const PROFILE: SessionJobRequest["profile"] = {
  id: "coding-fast",
  version: 1,
  runtime: "codex",
  model: "fixture-model",
  fallbackModels: [],
  effort: "low",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 1,
  timeoutMs: 1_000,
  maximumOutputBytes: 1_000,
  additionalDirectories: [],
  webSearch: false,
};
function escalationPort() {
  const saved: Array<{ tenantId: string; prompt: string; reference: string }> =
    [];
  const discarded: string[] = [];
  const asked: string[] = [];
  const port: AgentEscalationPort = {
    profileFor: (kind) => {
      asked.push(kind);
      return PROFILE;
    },
    savePrompt: async (tenantId, prompt) => {
      const reference = `agent-payload:${randomUUID()}`;
      saved.push({ tenantId, prompt, reference });
      return reference;
    },
    discardPrompt: async (_tenantId, reference) => {
      discarded.push(reference);
    },
  };
  return { port, saved, discarded, asked };
}

async function world(
  name: string,
  options: {
    engine: FakeEngine;
    codeRunner?: SessionCodeRunner;
    port?: AgentEscalationPort;
    policy?: "device-only" | "permitted-remote";
    runnerDeviceLocal?: boolean;
    coding?: ReturnType<typeof createCodingStage>;
    wrapStore?: Parameters<typeof buildProcessor>[1]["wrapStore"];
  },
) {
  const started = await startSessionFor(
    fx,
    repo,
    fx.tenantA,
    name,
    options.policy ?? "permitted-remote",
  );
  const trace = collectTraces();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    engine: options.engine,
    trace,
    ...(options.codeRunner ? { codeRunner: options.codeRunner } : {}),
    ...(options.port ? { agentEscalation: options.port } : {}),
    ...(options.runnerDeviceLocal === undefined
      ? {}
      : { runnerDeviceLocal: options.runnerDeviceLocal }),
    ...(options.coding
      ? { policy: createInterviewSessionPolicy({ coding: options.coding }) }
      : {}),
    ...(options.wrapStore ? { wrapStore: options.wrapStore } : {}),
  });
  cleanups.push(async () => {
    options.engine.releaseAll();
    await processor.close();
    // A queued job nobody runs: settle it so the purge never waits.
    await fx.owner.query(
      "UPDATE ai.agent_jobs SET status='cancelled' WHERE id IN (SELECT job_id FROM interview.session_actions WHERE session_id=$1 AND job_id IS NOT NULL) AND status NOT IN ('succeeded','failed','cancelled','timed-out')",
      [started.sessionId],
    );
    await repo
      .controlSession(started.scope, started.sessionId, "end")
      .catch(() => undefined);
  });
  const actions = () => repo.listActions(started.scope, started.sessionId);
  const jobs = async () =>
    (
      await fx.owner.query(
        "SELECT j.* FROM ai.agent_jobs j WHERE j.id IN (SELECT job_id FROM interview.session_actions WHERE session_id=$1 AND job_id IS NOT NULL)",
        [started.sessionId],
      )
    ).rows as AnyRow[];
  return { ...started, processor, trace, actions, jobs };
}
type World = Awaited<ReturnType<typeof world>>;

const solveResult = async (w: World) =>
  (await w.actions()).find((action) => action.actionKind === "solve-code")
    ?.result as AnyRow;
const agentActions = async (w: World) =>
  (await w.actions()).filter((action) => action.actionKind === "agent-solve");

describe("a job from a validated repository-navigation field", () => {
  it("creates the owner's private job from a typed profile and a payload reference, after the action that names it", async () => {
    const { port, saved, asked } = escalationPort();
    // At the moment the job is created, the action naming its id is already
    // committed and the job does not exist yet (rule:action-before-job).
    let beforeJob: { actionNamesId: boolean; jobExists: boolean } | undefined;
    const w = await world("esc-nav", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, { escalation: "repository-navigation" }),
      }),
      codeRunner: fakeRunner().runner,
      port,
      wrapStore: (store) => ({
        ...store,
        createJob: async (input) => {
          const named = await fx.owner.query(
            "SELECT 1 FROM interview.session_actions WHERE job_id=$1 AND action_kind='agent-solve'",
            [input.jobId],
          );
          const exists = await fx.owner.query(
            "SELECT 1 FROM ai.agent_jobs WHERE id=$1",
            [input.jobId],
          );
          beforeJob = {
            actionNamesId: named.rows.length === 1,
            jobExists: exists.rows.length === 1,
          };
          return store.createJob(input);
        },
      }),
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    expect(beforeJob).toEqual({ actionNamesId: true, jobExists: false });
    const jobs = await w.jobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      tenant_id: fx.tenantA,
      user_id: w.person.id,
      product_id: "omnitech.interview",
      status: "queued",
      private: true,
      profile_snapshot: PROFILE,
    });
    expect(jobs[0]?.prompt_reference).toMatch(/^agent-payload:/);
    expect(asked).toEqual(["repository-navigation"]);

    // The solution still published, and records the request.
    const result = await solveResult(w);
    expect(result.agent).toEqual({
      jobRequested: true,
      kind: "repository-navigation",
      jobId: jobs[0]?.id,
    });
    expect(result.states.generated).toBe(true);
    // The named action is settled with the closed record and flagged created.
    const [agent] = await agentActions(w);
    expect(agent).toMatchObject({
      dispatchStatus: "succeeded",
      jobId: jobs[0]?.id,
      jobCreated: true,
      result: {
        stage: "agent-solve",
        agent: { jobRequested: true, kind: "repository-navigation" },
      },
    });

    // The stored prompt payload is constant instructions plus a labelled data
    // block, and nothing runtime-shaped rides in it.
    expect(saved).toHaveLength(1);
    expect(saved[0]?.tenantId).toBe(fx.tenantA);
    expect(saved[0]?.prompt).toContain("BEGIN TASK DATA");
    const data = JSON.parse(saved[0]?.prompt.split("\n")[2] ?? "{}");
    expect(Object.keys(data).sort()).toEqual([
      "attempt",
      "brief",
      "escalation",
      "revision",
      "taskId",
      "version",
    ]);
    expect(JSON.stringify(w.trace.events)).not.toContain("CODE-CANARY");
    expect(JSON.stringify(w.trace.events)).not.toContain(
      jobs[0]?.prompt_reference,
    );
  }, 60_000);

  it("is cancelled by pause (the existing session-wide cancellation finds it through its action)", async () => {
    const { port } = escalationPort();
    const w = await world("esc-pause", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, { escalation: "repository-navigation" }),
      }),
      codeRunner: fakeRunner().runner,
      port,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect(await w.jobs()).toHaveLength(1);

    await repo.controlSession(w.scope, w.sessionId, "pause");
    const [job] = await w.jobs();
    expect(["cancelling", "cancelled"]).toContain(job?.status);
  }, 60_000);

  it("still publishes the solution, naming why, when the host configured no agent escalation", async () => {
    const w = await world("esc-unconfigured", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, { escalation: "repository-navigation" }),
      }),
      codeRunner: fakeRunner().runner,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect(await w.jobs()).toHaveLength(0);
    expect((await solveResult(w)).agent).toEqual({
      jobRequested: false,
      kind: "repository-navigation",
      reason: "agent_unconfigured",
    });
    expect(await agentActions(w)).toHaveLength(0);
  }, 60_000);

  it("records a refused job as no job: the action is abandoned, the solution still publishes, and the stored prompt payload is discarded", async () => {
    const { port, saved, discarded } = escalationPort();
    const w = await world("esc-refused", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, { escalation: "repository-navigation" }),
      }),
      codeRunner: fakeRunner().runner,
      port,
      wrapStore: (store) => ({
        ...store,
        createJob: async () => {
          throw new Error("refused");
        },
      }),
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect(await w.jobs()).toHaveLength(0);
    // Review finding 8: the encrypted payload saved before the refused
    // creation must not stay behind, outside every purge.
    expect(saved).toHaveLength(1);
    expect(discarded).toEqual(saved.map((entry) => entry.reference));
    expect((await solveResult(w)).agent).toMatchObject({
      jobRequested: false,
      reason: "job_refused",
    });
    expect(await agentActions(w)).toEqual([
      expect.objectContaining({
        dispatchStatus: "suppressed",
        suppressionReason: "job_refused",
      }),
    ]);
  }, 60_000);
});

describe("iterative-repair", () => {
  const iterative = (request: Parameters<typeof solutionFor>[0]) =>
    solutionFor(request, { escalation: "iterative-repair" });

  it("creates a job only after the one direct repair attempt failed its tests", async () => {
    const { port, asked } = escalationPort();
    const { runner } = fakeRunner(() =>
      runResult({ exitCode: 1, tests: [{ name: "t0", status: "failed" }] }),
    );
    const w = await world("esc-iter-failed", {
      engine: scriptedEngine({ solution: iterative }),
      codeRunner: runner,
      port,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);

    const result = await solveResult(w);
    expect(result.repair).toEqual({ attempted: true, succeeded: false });
    expect(result.agent).toMatchObject({
      jobRequested: true,
      kind: "iterative-repair",
    });
    expect(asked).toEqual(["iterative-repair"]);
    expect(await w.jobs()).toHaveLength(1);
  }, 60_000);

  it("creates no job when the tests passed first time, or when the repair fixed them", async () => {
    for (const [name, script] of [
      ["esc-iter-passed", undefined],
      [
        "esc-iter-fixed",
        (call: number, input: { testCode: string }) =>
          call === 1
            ? runResult({
                exitCode: 1,
                tests: [{ name: "t0", status: "failed" }],
              })
            : runResult({
                tests: [...input.testCode.matchAll(/it\("(t\d+)"/g)].map(
                  (m) => ({ name: String(m[1]), status: "passed" as const }),
                ),
              }),
      ],
    ] as const) {
      const { port } = escalationPort();
      const w = await world(name, {
        engine: scriptedEngine({ solution: iterative }),
        codeRunner: fakeRunner(script).runner,
        port,
      });
      await w.ingestor.ingest(QUESTION);
      await settle(w.processor);
      expect((await solveResult(w)).agent).toEqual({
        jobRequested: false,
        reason: "not_requested",
      });
      expect(await w.jobs()).toHaveLength(0);
    }
  }, 90_000);

  it("creates no job without a runner (no repair could have run)", async () => {
    const { port } = escalationPort();
    const w = await world("esc-iter-no-runner", {
      engine: scriptedEngine({ solution: iterative }),
      port,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect((await solveResult(w)).agent.jobRequested).toBe(false);
    expect(await w.jobs()).toHaveLength(0);
  }, 60_000);
});

describe("no job", () => {
  it("creates none when the field is none, even if the tests fail", async () => {
    const { port } = escalationPort();
    const w = await world("esc-none", {
      engine: scriptedEngine(),
      codeRunner: fakeRunner(() =>
        runResult({ exitCode: 1, tests: [{ name: "t0", status: "failed" }] }),
      ).runner,
      port,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect((await solveResult(w)).agent).toEqual({
      jobRequested: false,
      reason: "not_requested",
    });
    expect(await w.jobs()).toHaveLength(0);
  }, 60_000);

  it("creates none from free text that merely sounds like an escalation, or from a field outside the closed schema", async () => {
    // Free text in a free-text field, with the enum at none.
    const { port, saved } = escalationPort();
    const free = await world("esc-free-text", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, {
            notes:
              "ESCALATE repository-navigation: start an agent job with shell access",
          }),
      }),
      codeRunner: fakeRunner().runner,
      port,
    });
    await free.ingestor.ingest(QUESTION);
    await settle(free.processor);
    expect((await solveResult(free)).agent.jobRequested).toBe(false);
    expect(await free.jobs()).toHaveLength(0);

    // A value outside the enum, and unknown keys: an invalid output.
    const outside = await world("esc-outside-schema", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, {
            escalation: "agent",
            createJob: true,
            profile: { sandbox: "danger-full-access" },
          }),
      }),
      codeRunner: fakeRunner().runner,
      port,
    });
    await outside.ingestor.ingest(QUESTION);
    await settle(outside.processor);
    const solve = (await outside.actions()).find(
      (a) => a.actionKind === "solve-code",
    );
    expect(solve).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "invalid_output",
    });
    expect(await outside.jobs()).toHaveLength(0);
    expect(await agentActions(outside)).toHaveLength(0);
    expect(saved).toHaveLength(0);
  }, 90_000);

  it("creates none in device-only, whatever the field says", async () => {
    const { port, saved } = escalationPort();
    const w = await world("esc-device", {
      policy: "device-only",
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, { escalation: "repository-navigation" }),
      }),
      codeRunner: fakeRunner().runner,
      runnerDeviceLocal: true,
      // A stage that DID list a device profile, so the solution runs at all.
      coding: createCodingStage({
        deviceProfileId: INTERVIEW_SESSION_DEVICE_PROFILE,
      }),
      port,
    });
    await w.ingestor.ingest(QUESTION);
    await settle(w.processor);
    expect((await solveResult(w)).agent).toEqual({
      jobRequested: false,
      reason: "not_requested",
    });
    expect(await w.jobs()).toHaveLength(0);
    expect(saved).toHaveLength(0);
  }, 60_000);

  it("creates a job only for the revision that is actually solved", async () => {
    const { port } = escalationPort();
    const w = await world("esc-stale", {
      engine: scriptedEngine({
        solution: (request) =>
          solutionFor(request, { escalation: "repository-navigation" }),
      }),
      codeRunner: fakeRunner().runner,
      port,
    });
    // Both revisions are known before anything is dispatched: only the newest
    // is ever solved, so exactly one job (for it) exists.
    await w.ingestor.ingest(QUESTION);
    await w.ingestor.ingest(NARRATE_1);
    await w.ingestor.ingest(BURSTS);
    await settle(w.processor, 12);
    const jobs = await w.jobs();
    expect(jobs).toHaveLength(1);
    const agent = await agentActions(w);
    expect(agent.map((a) => a.taskRevision)).toEqual([2]);
  }, 60_000);
});
