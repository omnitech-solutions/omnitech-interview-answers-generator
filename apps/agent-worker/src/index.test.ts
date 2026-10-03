import type {
  AgentJob,
  AgentJobWorkerRepository,
} from "@omnitech/agent-job-service";
import type {
  AgentEvent,
  AgentProfile,
} from "@omnitech/agent-runtime-contracts";
import { describe, expect, it } from "vitest";
import { runAgentWorker } from "./index.js";

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
  };
}

describe("agent worker lifecycle", () => {
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
