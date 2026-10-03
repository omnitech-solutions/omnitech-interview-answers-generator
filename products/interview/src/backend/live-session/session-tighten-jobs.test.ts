// Tightening a session to device-only cancels the agent jobs it already queued
// (S5): the agent worker claims any queued job without a policy check, so a
// remote job left queued would still launch after the owner asked for
// device-only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  QUESTION,
  runResult,
  scriptedGateway,
  solutionFor,
} from "./coding-fixture.js";
import type { AgentEscalationPort } from "./escalation.js";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  collectTraces,
  NEVER_ABORTED,
  settle,
  startSessionFor,
} from "./processor-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import type { SessionCodeRunner } from "./session-run.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

it("cancels a queued agent job when the session tightens to device-only", async () => {
  const started = await startSessionFor(
    fx,
    repo,
    fx.tenantA,
    "tighten-queued",
    "permitted-remote",
  );
  const runner: SessionCodeRunner = {
    runAll: async () =>
      runResult({ exitCode: 1, tests: [{ name: "t0", status: "failed" }] }),
  };
  const gateway = scriptedGateway({
    solution: (req) =>
      solutionFor(req, { escalation: "repository-navigation" }),
  });
  const port: AgentEscalationPort = {
    profileFor: () => ({
      id: "coding-fast",
      version: 1,
      runtime: "codex",
      model: "m",
      fallbackModels: [],
      effort: "low",
      tools: [],
      sandbox: "read-only",
      approvalPolicy: "never",
      sessionPersistence: false,
      maximumTurns: 1,
      timeoutMs: 1000,
      maximumOutputBytes: 1000,
      additionalDirectories: [],
      webSearch: false,
    }),
    savePrompt: async () => `agent-payload:${randomUUID()}`,
  };
  const processor = buildProcessor(fx, {
    workerId: "w-tighten-queued",
    gateway,
    trace: collectTraces(),
    codeRunner: runner,
    agentEscalation: port,
  });
  await started.ingestor.ingest(QUESTION);
  const jobsOf = () =>
    fx.owner.query(
      `SELECT j.id, j.status FROM ai.agent_jobs j WHERE j.id IN (
         SELECT job_id FROM interview.session_actions
         WHERE session_id=$1 AND job_id IS NOT NULL AND job_created)`,
      [started.sessionId],
    );
  for (let i = 0; i < 100; i += 1) {
    gateway.releaseAll?.();
    await processor.tick(NEVER_ABORTED);
    if ((await jobsOf()).rows.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const before = (await jobsOf()).rows;
  expect(before.length).toBeGreaterThan(0);
  expect(before.some((row) => row.status === "queued")).toBe(true);

  await repo.tightenProcessingPolicy(
    started.scope,
    started.sessionId,
    "device-only",
  );
  gateway.releaseAll?.();
  await settle(processor, 20);

  const ids = before.map((row) => row.id);
  const claimable = await fx.owner.query(
    "SELECT count(*)::int AS n FROM ai.agent_jobs WHERE id = ANY($1::uuid[]) AND status = 'queued'",
    [ids],
  );
  expect(claimable.rows[0].n).toBe(0);
  await processor.close();
}, 120_000);
