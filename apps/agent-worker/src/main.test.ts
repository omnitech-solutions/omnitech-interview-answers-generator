import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { AgentJob } from "@omnitech/agent-job-service";
import type {
  AgentEvent,
  AgentProfile,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runConfiguredAgentWorker } from "./main.js";

const secret = "worker-payload-secret-0123456789abcdef";

// The Codex CLI the SDK spawns; the only stand-in in the Codex path. It
// answers every turn by echoing its prompt.
const fakeCodex = `#!${process.execPath}
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  emit({ type: "thread.started", thread_id: "thread-1" });
  emit({ type: "item.completed", item: { id: "a1", type: "agent_message", text: "Echo: " + input } });
  emit({ type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 2 } });
});
`;

const profile = (runtime: AgentProfile["runtime"]): AgentProfile => ({
  id: "interview-coach",
  version: 1,
  runtime,
  model: "test-model",
  fallbackModels: [],
  effort: "low",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: true,
  maximumTurns: 1,
  timeoutMs: 60_000,
  maximumOutputBytes: 100_000,
  additionalDirectories: [],
  webSearch: false,
});

// The worker runs as fixture_member, a NOSUPERUSER NOBYPASSRLS role, so it
// reaches tenant jobs only through the agent-worker policies, as in production.
let pg: DisposablePostgres;
let member: PlatformDatabase;
let jobs: PostgresAgentJobRepository;
let payloads: AgentPayloadStore;
let tenantId: string;
let userId: string;
let fakeDirectory: string;

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, ai TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, ai TO fixture_member;`);
  userId = (
    await pg.owner.query<{ id: string }>(
      "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
    )
  ).rows[0]!.id;
  tenantId = (
    await pg.owner.query<{ id: string }>(
      "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North') RETURNING id",
    )
  ).rows[0]!.id;
  member = createPlatformDatabase(pg.memberUrl);
  jobs = new PostgresAgentJobRepository(member);
  payloads = new AgentPayloadStore(member, secret);

  fakeDirectory = await mkdtemp(join(tmpdir(), "worker-codex-"));
  await mkdir(join(fakeDirectory, "bin"));
  await writeFile(join(fakeDirectory, "bin", "codex"), fakeCodex);
  await chmod(join(fakeDirectory, "bin", "codex"), 0o755);
}, 30_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
  await rm(fakeDirectory, { recursive: true, force: true });
});

async function enqueue(runtime: AgentProfile["runtime"], prompt: string) {
  return jobs.create({
    tenantId,
    userId,
    productId: "omnitech.interview",
    profile: profile(runtime),
    promptReference: await payloads.save(tenantId, prompt),
  });
}

// Runs the configured worker until `done` holds for the job, then stops it.
async function runUntil(
  job: AgentJob,
  done: (current: AgentJob) => boolean,
  env: Record<string, string | undefined>,
  runtimes?: Readonly<Record<string, AgentRuntimeAdapter>>,
): Promise<AgentJob> {
  const controller = new AbortController();
  const worker = runConfiguredAgentWorker(
    { DATABASE_URL: pg.memberUrl, AGENT_WORKER_POLL_MS: "10", ...env },
    controller.signal,
    ...(runtimes ? [runtimes] : []),
  );
  const deadline = Date.now() + 15_000;
  let current = await jobs.get(tenantId, userId, job.id);
  while (!current || !done(current)) {
    if (Date.now() > deadline)
      throw new Error(`Job stayed ${current?.status ?? "missing"}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    current = await jobs.get(tenantId, userId, job.id);
  }
  controller.abort();
  await worker;
  return current;
}

async function eventTypes(jobId: string) {
  return (await jobs.eventsAfter(tenantId, userId, jobId, 0)).map(
    ({ event }) => event.type,
  );
}

function fakeRuntime(
  run: (signal: { cancelled: boolean }) => AsyncIterable<AgentEvent>,
): AgentRuntimeAdapter & { cancelled: string[] } {
  const cancelled: string[] = [];
  const state = { cancelled: false };
  return {
    cancelled,
    runtime: "claude-code",
    capabilities: {
      resume: true,
      structuredOutput: true,
      attachments: false,
      tools: false,
    },
    run: () => run(state),
    resume: () => run(state),
    async cancel(runId) {
      cancelled.push(runId);
      state.cancelled = true;
    },
  };
}

const finished = (job: AgentJob) =>
  ["succeeded", "failed", "cancelled"].includes(job.status);

describe("configured agent worker", () => {
  it("claims a Codex job, runs it through the installed CLI and stores its result", async () => {
    const job = await enqueue("codex", "Explain closures");

    const done = await runUntil(job, finished, {
      AGENT_PAYLOAD_SECRET: secret,
      AGENT_WORKER_ID: "worker-codex",
      CODEX_PATH: join(fakeDirectory, "bin", "codex"),
    });

    expect(done).toMatchObject({
      status: "succeeded",
      sessionId: "thread-1",
      // One of the worker's loops, each under its own id.
      claimedBy: expect.stringMatching(/^worker-codex(:\d+)?$/),
    });
    expect(await eventTypes(job.id)).toEqual([
      "started",
      "text-delta",
      "usage",
      "completed",
    ]);
    expect(JSON.parse(await payloads.load(done.resultReference!))).toEqual({
      sessionId: "thread-1",
      output: "Echo: Explain closures",
    });
  });

  it("finds the Codex CLI on PATH and accepts the connected-account secret", async () => {
    const job = await enqueue("codex", "Explain hoisting");

    const done = await runUntil(job, finished, {
      CONNECTED_ACCOUNT_SECRET: secret,
      PATH: [join(fakeDirectory, "missing"), join(fakeDirectory, "bin")].join(
        delimiter,
      ),
    });

    expect(done.status).toBe("succeeded");
    expect(JSON.parse(await payloads.load(done.resultReference!))).toEqual({
      sessionId: "thread-1",
      output: "Echo: Explain hoisting",
    });
  });

  it("cancels a running job when its tenant asks to", async () => {
    const job = await enqueue("claude-code", "Long task");
    const runtime = fakeRuntime(async function* (state) {
      yield { type: "started", sessionId: "session-c" };
      while (!state.cancelled) {
        yield { type: "text-delta", text: "." };
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });

    const controller = new AbortController();
    const worker = runConfiguredAgentWorker(
      {
        DATABASE_URL: pg.memberUrl,
        AGENT_WORKER_POLL_MS: "10",
        AGENT_PAYLOAD_SECRET: secret,
      },
      controller.signal,
      { "claude-code": runtime },
    );
    while ((await jobs.get(tenantId, userId, job.id))?.status !== "running")
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await jobs.requestCancellation(tenantId, userId, job.id)).toBe(
      "requested",
    );
    let current = await jobs.get(tenantId, userId, job.id);
    while (current?.status !== "cancelled") {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = await jobs.get(tenantId, userId, job.id);
    }
    controller.abort();
    await worker;

    expect(runtime.cancelled).toEqual([job.id]);
    expect(current.resultReference).toBeUndefined();
    expect((await eventTypes(job.id)).at(-1)).toBe("failed");
  });

  it("marks a job failed when its runtime fails, and keeps serving", async () => {
    const failing = await enqueue("claude-code", "Break");
    const runtime = fakeRuntime(async function* () {
      yield {
        type: "failed",
        error: { code: "provider", message: "Overloaded", retryable: true },
      };
    });

    const done = await runUntil(
      failing,
      finished,
      { AGENT_PAYLOAD_SECRET: secret },
      { "claude-code": runtime },
    );

    expect(done.status).toBe("failed");
    expect(
      (await jobs.eventsAfter(tenantId, userId, failing.id, 0)).at(-1)?.event,
    ).toEqual({
      type: "failed",
      error: { code: "provider", message: "Overloaded", retryable: true },
    });
  });

  it("fails a job whose runtime is not configured", async () => {
    const job = await enqueue("codex", "Nobody runs this");

    const done = await runUntil(
      job,
      finished,
      { AGENT_PAYLOAD_SECRET: secret },
      { "claude-code": fakeRuntime(async function* () {}) },
    );

    expect(done.status).toBe("failed");
  });

  it("refuses to start without a payload secret", async () => {
    await expect(
      runConfiguredAgentWorker(
        { DATABASE_URL: pg.memberUrl },
        new AbortController().signal,
      ),
    ).rejects.toThrow("AGENT_PAYLOAD_SECRET is required by the agent worker.");
  });

  it("runs as a program, completes a job, and stops cleanly on SIGTERM", async () => {
    const job = await enqueue("codex", "Explain the event loop");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./main.ts", import.meta.url))],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: pg.memberUrl,
          AGENT_PAYLOAD_SECRET: secret,
          AGENT_WORKER_POLL_MS: "10",
          CODEX_PATH: join(fakeDirectory, "bin", "codex"),
        },
      },
    );
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    const deadline = Date.now() + 15_000;
    let current = await jobs.get(tenantId, userId, job.id);
    while (current?.status !== "succeeded") {
      if (Date.now() > deadline) throw new Error(`Job ${current?.status}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      current = await jobs.get(tenantId, userId, job.id);
    }

    child.kill("SIGTERM");

    expect(await exited).toBe(0);
    expect(JSON.parse(await payloads.load(current.resultReference!))).toEqual({
      sessionId: "thread-1",
      output: "Echo: Explain the event loop",
    });
  }, 30_000);

  it("starts as a program and reports a missing secret", async () => {
    const env = { ...process.env };
    delete env["AGENT_PAYLOAD_SECRET"];
    delete env["CONNECTED_ACCOUNT_SECRET"];

    const failure = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./main.ts", import.meta.url))],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), env },
    ).catch((error: { code: number; stderr: string }) => error);

    expect(failure).toMatchObject({ code: 1 });
    expect((failure as { stderr: string }).stderr).toContain(
      "AGENT_PAYLOAD_SECRET is required by the agent worker.",
    );
  }, 20_000);
});
