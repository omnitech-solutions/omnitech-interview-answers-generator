import type {
  AgentJob,
  AgentJobWorkerRepository,
} from "@omnitech/agent-job-service";
import type {
  AgentEvent,
  AgentProfile,
} from "@omnitech/agent-runtime-contracts";
import { describe, expect, it } from "vitest";
import { runAgentWorker } from "./index";

const profile: AgentProfile = {
  id: "presentation-editor",
  version: 1,
  runtime: "claude-code",
  model: "test-model",
  fallbackModels: [],
  effort: "high",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: true,
  maximumTurns: 2,
  timeoutMs: 60_000,
  maximumOutputBytes: 100_000,
  additionalDirectories: [],
  webSearch: false,
};

function job(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-000000000002",
    userId: "00000000-0000-0000-0000-000000000003",
    productId: "omnitech.presentation",
    status: "claimed",
    profile,
    promptReference: "prompt:1",
    private: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function repositoryFor(
  firstJob: AgentJob,
  onIdle: () => void,
): AgentJobWorkerRepository & {
  transitions: string[];
  events: AgentEvent[];
} {
  let claimed = false;
  const transitions: string[] = [];
  const events: AgentEvent[] = [];
  return {
    transitions,
    events,
    async get() {
      return firstJob;
    },
    async setResultReference() {},
    async setSessionId() {},
    async renewLease() {
      return true;
    },
    async claim() {
      if (claimed) {
        onIdle();
        return undefined;
      }
      claimed = true;
      return firstJob;
    },
    async transition(_id, _expected, next) {
      transitions.push(next);
      return true;
    },
    async appendEvent(_id, event) {
      events.push(event);
      return {
        jobId: firstJob.id,
        sequence: events.length,
        event,
        createdAt: new Date(),
      };
    },
    async finalize(_id, _expected, next, event) {
      transitions.push(next);
      events.push(event);
      return true;
    },
  };
}

describe("agent worker lifecycle", () => {
  it("keeps claiming after one claim attempt fails", async () => {
    const controller = new AbortController();
    const repository = repositoryFor(job(), () => controller.abort());
    const claim = repository.claim.bind(repository);
    let attempts = 0;
    repository.claim = async (...args) => {
      if (++attempts === 1) throw new Error("transient claim error");
      return claim(...args);
    };
    await runAgentWorker(
      {
        workerId: "worker",
        repository,
        runtimes: {},
        loadPrompt: async () => "unused",
        pollIntervalMs: 1,
        concurrency: 2,
      },
      controller.signal,
    );
    expect(attempts).toBeGreaterThan(1);
    expect(repository.transitions).toContain("failed");
  });

  it("keeps sibling loops alive when a lifecycle write unexpectedly fails", async () => {
    const controller = new AbortController();
    const repository = repositoryFor(job(), () => controller.abort());
    repository.appendEvent = async () => {
      throw new Error("transient event write error");
    };
    await expect(
      runAgentWorker(
        {
          workerId: "worker",
          repository,
          runtimes: {},
          loadPrompt: async () => "unused",
          pollIntervalMs: 1,
          concurrency: 2,
        },
        controller.signal,
      ),
    ).resolves.toBeUndefined();
  });

  it("persists awaiting-input instead of publishing a partial result", async () => {
    const controller = new AbortController();
    const repository = repositoryFor(job(), () => controller.abort());
    const runtime = {
      runtime: "claude-code" as const,
      capabilities: {
        resume: true,
        structuredOutput: true,
        attachments: false,
        tools: true,
      },
      async *run(): AsyncIterable<AgentEvent> {
        yield { type: "started", sessionId: "session-1" };
        yield { type: "awaiting-input", request: { approval: "write" } };
      },
      async *resume(): AsyncIterable<AgentEvent> {
        return;
      },
      async cancel() {},
    };

    await runAgentWorker(
      {
        workerId: "worker-1",
        repository,
        runtimes: { "claude-code": runtime },
        loadPrompt: async () => "edit the slide",
      },
      controller.signal,
    );

    expect(repository.transitions).toEqual([
      "starting",
      "running",
      "awaiting-input",
    ]);
    expect(repository.events.at(-1)?.type).toBe("awaiting-input");
  });

  it("fails a runtime that ends without a terminal event", async () => {
    const controller = new AbortController();
    const repository = repositoryFor(job(), () => controller.abort());
    await runAgentWorker(
      {
        workerId: "worker",
        repository,
        runtimes: {
          "claude-code": {
            runtime: "claude-code",
            capabilities: {
              resume: false,
              structuredOutput: true,
              attachments: false,
              tools: false,
            },
            async *run(): AsyncIterable<AgentEvent> {},
            async *resume(): AsyncIterable<AgentEvent> {},
            async cancel() {},
          },
        },
        loadPrompt: async () => "write",
      },
      controller.signal,
    );
    expect(repository.transitions.at(-1)).toBe("failed");
    expect(repository.events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "infrastructure" },
    });
  });

  it("fails a job that outlives its profile timeout and cancels the runtime, even when the runtime ignores the cancel", async () => {
    const controller = new AbortController();
    const repository = repositoryFor(
      job({ profile: { ...profile, timeoutMs: 40 } }),
      () => controller.abort(),
    );
    const cancelled: string[] = [];
    await runAgentWorker(
      {
        workerId: "worker",
        repository,
        runtimes: {
          "claude-code": {
            runtime: "claude-code",
            capabilities: {
              resume: false,
              structuredOutput: true,
              attachments: false,
              tools: false,
            },
            // Never yields and never ends, whatever cancel does.
            async *run(): AsyncIterable<AgentEvent> {
              await new Promise<void>(() => undefined);
            },
            async *resume(): AsyncIterable<AgentEvent> {},
            async cancel(id: string) {
              cancelled.push(id);
            },
          },
        },
        loadPrompt: async () => "write",
        pollIntervalMs: 5,
      },
      controller.signal,
    );
    expect(cancelled).toHaveLength(1);
    expect(repository.transitions.at(-1)).toBe("failed");
    expect(repository.events.at(-1)).toEqual({
      type: "failed",
      error: {
        code: "timeout",
        message: "The agent job exceeded its time limit.",
        retryable: true,
      },
    });
  });

  it("resumes a checkpoint and stores the completed result", async () => {
    const controller = new AbortController();
    const repository = repositoryFor(
      job({ status: "claimed", sessionId: "session-1" }),
      () => controller.abort(),
    );
    let resumed = false;
    const runtime = {
      runtime: "claude-code" as const,
      capabilities: {
        resume: true,
        structuredOutput: true,
        attachments: false,
        tools: true,
      },
      async *run(): AsyncIterable<AgentEvent> {
        return;
      },
      async *resume(): AsyncIterable<AgentEvent> {
        resumed = true;
        yield {
          type: "completed",
          result: { sessionId: "session-1", output: { ok: true } },
        };
      },
      async cancel() {},
    };
    let resultReference = "";

    await runAgentWorker(
      {
        workerId: "worker-1",
        repository,
        runtimes: { "claude-code": runtime },
        loadPrompt: async () => "continue",
        storeResult: async () => {
          resultReference = "result:1";
          return resultReference;
        },
      },
      controller.signal,
    );

    expect(resumed).toBe(true);
    expect(resultReference).toBe("result:1");
    expect(repository.transitions).toContain("succeeded");
  });
});

it("marks payload failure and keeps the worker alive for the next job", async () => {
  const controller = new AbortController();
  const repository = repositoryFor(job(), () => controller.abort());
  await expect(
    runAgentWorker(
      {
        workerId: "worker",
        repository,
        runtimes: {
          "claude-code": {
            runtime: "claude-code",
            capabilities: {
              resume: true,
              structuredOutput: true,
              attachments: false,
              tools: false,
            },
            async *run() {
              yield { type: "started" as const, sessionId: "session" };
            },
            async *resume() {
              yield { type: "started" as const, sessionId: "session" };
            },
            async cancel() {},
          },
        },
        loadPrompt: async () => {
          throw new Error("Unavailable payload");
        },
      },
      controller.signal,
    ),
  ).resolves.toBeUndefined();
  expect(repository.transitions).toEqual(["starting", "failed"]);
  expect(repository.events.at(-1)).toMatchObject({
    type: "failed",
    error: { code: "infrastructure" },
  });
});

it("does not publish a completed result after cancellation", async () => {
  const controller = new AbortController();
  const repository = repositoryFor(job(), () => controller.abort());
  repository.get = async () => job({ status: "cancelling" });
  let cancelled = "";
  let stored = false;
  await runAgentWorker(
    {
      workerId: "worker",
      repository,
      loadPrompt: async () => "edit",
      storeResult: async () => {
        stored = true;
        return "result:cancelled";
      },
      runtimes: {
        "claude-code": {
          runtime: "claude-code",
          capabilities: {
            resume: true,
            structuredOutput: true,
            attachments: false,
            tools: false,
          },
          async *run() {
            yield {
              type: "completed" as const,
              result: { sessionId: "session", output: "must not publish" },
            };
          },
          async *resume() {
            return;
          },
          async cancel(id) {
            cancelled = id;
          },
        },
      },
    },
    controller.signal,
  );
  expect(cancelled).toBe(job().id);
  expect(stored).toBe(false);
  expect(repository.transitions).toEqual(["starting", "running", "cancelled"]);
  expect(repository.events).toEqual([
    {
      type: "failed",
      error: {
        code: "cancelled",
        message: "Agent job cancelled.",
        retryable: false,
      },
    },
  ]);
});

it("marks a thrown runtime failure and removes its temporary workspace", async () => {
  const controller = new AbortController();
  const repository = repositoryFor(job(), () => controller.abort());
  let workspace = "";
  await runAgentWorker(
    {
      workerId: "worker",
      repository,
      loadPrompt: async () => "edit",
      runtimes: {
        "claude-code": {
          runtime: "claude-code",
          capabilities: {
            resume: true,
            structuredOutput: true,
            attachments: false,
            tools: false,
          },
          async *run(request) {
            workspace = request.workingDirectory;
            throw new Error("private runtime detail");
          },
          async *resume() {
            return;
          },
          async cancel() {},
        },
      },
    },
    controller.signal,
  );
  expect(repository.transitions).toEqual(["starting", "running", "failed"]);
  expect(repository.events.at(-1)).toMatchObject({
    type: "failed",
    error: { code: "infrastructure" },
  });
  expect(JSON.stringify(repository.events)).not.toContain(
    "private runtime detail",
  );
  const { access } = await import("node:fs/promises");
  await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails a job whose stored profile is out of bounds without running it", async () => {
  const controller = new AbortController();
  // A snapshot no central profile could produce: an arbitrary directory.
  const repository = repositoryFor(
    job({ profile: { ...profile, additionalDirectories: ["/etc"] } }),
    () => controller.abort(),
  );
  let ran = false;
  await runAgentWorker(
    {
      workerId: "worker",
      repository,
      loadPrompt: async () => "edit",
      runtimes: {
        "claude-code": {
          runtime: "claude-code",
          capabilities: {
            resume: true,
            structuredOutput: true,
            attachments: false,
            tools: false,
          },
          async *run() {
            ran = true;
            yield { type: "started" as const, sessionId: "session" };
          },
          async *resume() {
            ran = true;
          },
          async cancel() {},
        },
      },
    },
    controller.signal,
  );
  expect(ran).toBe(false);
  expect(repository.transitions).toEqual(["failed"]);
  expect(repository.events).toEqual([
    {
      type: "failed",
      error: {
        code: "configuration",
        message: "The agent profile is outside its allowed bounds.",
        retryable: false,
      },
    },
  ]);
});

describe("agent worker concurrency", () => {
  // A queue of jobs, a runtime that takes a while, and a count of how many
  // were running at the same moment.
  function scenario(jobs: number, workMs: number) {
    const queue = Array.from({ length: jobs }, (_, index) =>
      job({ id: `00000000-0000-0000-0000-00000000010${index}` }),
    );
    const controller = new AbortController();
    const renewals: Array<[string, string, number]> = [];
    const claimedBy: string[] = [];
    let running = 0;
    let peak = 0;
    let finished = 0;
    const repository: AgentJobWorkerRepository = {
      async claim(workerId) {
        const next = queue.shift();
        if (next) claimedBy.push(workerId);
        return next;
      },
      async renewLease(jobId, workerId, leaseMs) {
        renewals.push([jobId, workerId, leaseMs]);
        return true;
      },
      async get() {
        return job();
      },
      async transition() {
        return true;
      },
      async setSessionId() {},
      async setResultReference() {},
      async appendEvent(_id, event) {
        return { jobId: _id, sequence: 1, event, createdAt: new Date() };
      },
      async finalize() {
        return true;
      },
    };
    const runtime = {
      runtime: "claude-code" as const,
      capabilities: {
        resume: false,
        structuredOutput: true,
        attachments: false,
        tools: false,
      },
      async *run(): AsyncIterable<AgentEvent> {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, workMs));
        running--;
        finished++;
        // The worker stops reading at "completed", so stop it from here.
        if (finished === jobs) setTimeout(() => controller.abort(), 20);
        yield {
          type: "completed",
          result: { output: {}, sessionId: "session" },
        };
      },
      async *resume(): AsyncIterable<AgentEvent> {
        return;
      },
      async cancel() {},
    };
    return {
      controller,
      repository,
      runtime,
      renewals,
      claimedBy,
      peak: () => peak,
    };
  }

  it("runs one job at a time unless told otherwise", async () => {
    const run = scenario(3, 20);
    await runAgentWorker(
      {
        workerId: "worker",
        repository: run.repository,
        runtimes: { "claude-code": run.runtime },
        loadPrompt: async () => "write",
        pollIntervalMs: 5,
      },
      run.controller.signal,
    );
    expect(run.peak()).toBe(1);
    expect(run.claimedBy).toHaveLength(3);
    expect(run.claimedBy.every((value) => value.startsWith("worker:"))).toBe(
      true,
    );
    expect(new Set(run.claimedBy).size).toBe(3);
  });

  it("runs several jobs side by side, each loop under its own worker id", async () => {
    const run = scenario(6, 40);
    await runAgentWorker(
      {
        workerId: "worker",
        repository: run.repository,
        runtimes: { "claude-code": run.runtime },
        loadPrompt: async () => "write",
        pollIntervalMs: 5,
        concurrency: 3,
      },
      run.controller.signal,
    );
    expect(run.peak()).toBe(3);
    expect(run.claimedBy).toHaveLength(6);
    expect(run.claimedBy.every((value) => /^worker:[123]:/.test(value))).toBe(
      true,
    );
    expect(new Set(run.claimedBy).size).toBe(6);
  });

  it("keeps the lease of a job that outlasts it, so no other loop takes it over", async () => {
    const run = scenario(1, 700);
    await runAgentWorker(
      {
        workerId: "worker",
        repository: run.repository,
        runtimes: { "claude-code": run.runtime },
        loadPrompt: async () => "write",
        pollIntervalMs: 5,
        leaseMs: 300,
        concurrency: 2,
      },
      run.controller.signal,
    );
    expect(run.renewals.length).toBeGreaterThanOrEqual(2);
    expect(run.renewals[0]?.[2]).toBe(300);
    expect(run.renewals.every(([, who]) => who.startsWith("worker:"))).toBe(
      true,
    );
  });
});

describe("agent worker lease and cancellation", () => {
  const capabilities = {
    resume: false,
    structuredOutput: true,
    attachments: false,
    tools: false,
  };
  // A runtime that stays quiet until it is cancelled, so only the heartbeat
  // can notice what happened to the job.
  function quietRuntime(cancelled: string[]) {
    let release: () => void = () => undefined;
    return {
      runtime: "claude-code" as const,
      capabilities,
      async *run(): AsyncIterable<AgentEvent> {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      async *resume(): AsyncIterable<AgentEvent> {
        return;
      },
      async cancel(id: string) {
        cancelled.push(id);
        release();
      },
    };
  }
  function run(
    overrides: Partial<AgentJobWorkerRepository>,
    runtime: ReturnType<typeof quietRuntime>,
  ) {
    const controller = new AbortController();
    const transitions: Array<[string, string | undefined]> = [];
    const repository = {
      ...repositoryFor(job(), () => controller.abort()),
      async transition(
        _id: string,
        _expected: readonly string[],
        next: string,
        claimant?: string,
      ) {
        transitions.push([next, claimant]);
        return true;
      },
      ...overrides,
    } as AgentJobWorkerRepository;
    const done = runAgentWorker(
      {
        workerId: "worker",
        repository,
        runtimes: { "claude-code": runtime },
        loadPrompt: async () => "write",
        pollIntervalMs: 5,
        leaseMs: 750,
      },
      controller.signal,
    );
    return { done, transitions };
  }

  it("stops the agent and writes nothing once its lease is lost", async () => {
    const cancelled: string[] = [];
    const { done, transitions } = run(
      {
        async renewLease() {
          return false;
        },
      },
      quietRuntime(cancelled),
    );
    await done;
    expect(cancelled).toHaveLength(1);
    expect(transitions.map(([status]) => status)).toEqual([
      "starting",
      "running",
    ]);
  });

  it("stops after two failed lease renewal attempts", async () => {
    const cancelled: string[] = [];
    let attempts = 0;
    const { done, transitions } = run(
      {
        async renewLease() {
          attempts += 1;
          throw new Error("database unavailable");
        },
      },
      quietRuntime(cancelled),
    );
    await done;
    expect(attempts).toBe(2);
    expect(cancelled).toHaveLength(1);
    expect(transitions.map(([status]) => status)).toEqual([
      "starting",
      "running",
    ]);
  });

  it("notices a cancel on its heartbeat when the agent is quiet", async () => {
    const cancelled: string[] = [];
    const { done } = run(
      {
        async get() {
          return job({ status: "cancelling" });
        },
      },
      quietRuntime(cancelled),
    );
    await done;
    expect(cancelled).toHaveLength(1);
  });

  it("stops the agent and ends the job as cancelled when a cancel lands while a lifecycle write is refused", async () => {
    // The tenant's cancel arrives between the runtime's `started` event and the
    // write that records it: that write is refused (the job is `cancelling`),
    // which used to skip straight to the failure handler, leaving the agent
    // running and the job waiting for its lease to run out.
    const cancelled: string[] = [];
    const finalized: Array<{ expected: readonly string[]; next: string }> = [];
    let refused = false;
    let release: () => void = () => undefined;
    const runtime = {
      runtime: "claude-code" as const,
      capabilities,
      async *run(): AsyncIterable<AgentEvent> {
        yield { type: "started", sessionId: "session-x" };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      async *resume(): AsyncIterable<AgentEvent> {
        return;
      },
      async cancel(id: string) {
        cancelled.push(id);
        release();
      },
    };
    const { done } = run(
      {
        async get() {
          return job({ status: refused ? "cancelling" : "running" });
        },
        async appendEvent() {
          refused = true;
          throw new Error("fenced write refused");
        },
        async finalize(_id: string, expected: readonly string[], next: string) {
          finalized.push({ expected, next });
          return expected.includes(refused ? "cancelling" : "running");
        },
      },
      runtime,
    );
    await done;
    expect(cancelled).toHaveLength(1);
    expect(finalized.at(-1)).toMatchObject({
      expected: ["cancelling"],
      next: "cancelled",
    });
  });

  it("moves every lifecycle write under the worker that holds the job", async () => {
    const cancelled: string[] = [];
    const { done, transitions } = run(
      {
        async renewLease() {
          return false;
        },
      },
      quietRuntime(cancelled),
    );
    await done;
    expect(
      transitions.every(([, claimant]) => claimant?.startsWith("worker:")),
    ).toBe(true);
  });

  it("ends a job whose completion raced a cancel as cancelled", async () => {
    const controller = new AbortController();
    const transitions: string[] = [];
    const repository = {
      ...repositoryFor(job(), () => controller.abort()),
      async finalize(
        _id: string,
        _expected: readonly string[],
        next: string,
        event: AgentEvent,
      ) {
        transitions.push(next);
        if (next === "succeeded") return false;
        this.events.push(event);
        return true;
      },
    } as AgentJobWorkerRepository & { events: AgentEvent[] };
    await runAgentWorker(
      {
        workerId: "worker",
        repository,
        runtimes: {
          "claude-code": {
            runtime: "claude-code",
            capabilities,
            async *run(): AsyncIterable<AgentEvent> {
              yield {
                type: "completed",
                result: { output: {}, sessionId: "s" },
              };
            },
            async *resume(): AsyncIterable<AgentEvent> {
              return;
            },
            async cancel() {},
          },
        },
        loadPrompt: async () => "write",
        pollIntervalMs: 5,
      },
      controller.signal,
    );
    expect(transitions).toEqual(["succeeded", "cancelled"]);
    expect(
      repository.events.filter(
        (event) => event.type === "failed" || event.type === "completed",
      ),
    ).toHaveLength(1);
    expect(repository.events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "cancelled" },
    });
  });
});
