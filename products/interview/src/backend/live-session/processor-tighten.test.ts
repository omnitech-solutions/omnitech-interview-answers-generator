// Device-only is enforced INSIDE a running dispatch (S5-2): a session tightened
// to device-only while its coding dispatch is between two gateway calls sends
// no further remote request and creates no agent job; the standing is re-read
// before every call and before an escalation job is requested.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  NEVER_ABORTED,
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

const PROFILE = {
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
} as const;

async function tickUntil(
  tick: () => Promise<void>,
  done: () => boolean,
  limit = 200,
) {
  for (let i = 0; i < limit && !done(); i += 1) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("a tighten in the middle of a coding dispatch", () => {
  it("sends no remote repair call and creates no agent job", async () => {
    const started = await startSessionFor(fx, repo, fx.tenantA, "tighten-mid");
    let now = 9_000_000;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached = false;
    let runs = 0;
    // The first test run fails (so a repair is owed) and is held open.
    const runner: SessionCodeRunner = {
      runAll: async () => {
        runs += 1;
        if (runs === 1) {
          reached = true;
          await gate;
        }
        return runResult({
          exitCode: 1,
          tests: [{ name: "t0", status: "failed" }],
        });
      },
    };
    const gateway = scriptedGateway({
      solution: (request) =>
        solutionFor(request, { escalation: "iterative-repair" }),
    });
    const port: AgentEscalationPort = {
      profileFor: () => PROFILE as never,
      savePrompt: async () => `agent-payload:${randomUUID()}`,
    };
    const processor = buildProcessor(fx, {
      workerId: "worker-tighten-mid",
      gateway,
      codeRunner: runner,
      agentEscalation: port,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
    });
    await started.ingestor.ingest(QUESTION);
    await tickUntil(
      async () => {
        now += 2_000;
        await processor.tick(NEVER_ABORTED);
      },
      () => reached,
    );
    expect(reached).toBe(true);
    const before = gateway.requests.length;

    await repo.tightenProcessingPolicy(
      started.scope,
      started.sessionId,
      "device-only",
    );
    release();
    for (let i = 0; i < 20; i += 1) {
      now += 2_000;
      await processor.tick(NEVER_ABORTED);
      await processor.idle();
    }
    const after = gateway.requests.slice(before);
    const jobs = await fx.owner.query(
      "SELECT id FROM ai.agent_jobs WHERE id IN (SELECT job_id FROM interview.session_actions WHERE session_id=$1 AND job_id IS NOT NULL)",
      [started.sessionId],
    );
    const actions = await repo.listActions(started.scope, started.sessionId);
    gateway.releaseAll();
    await processor.close();
    // The dispatch under the old policy ended as policy_changed; nothing it
    // began was published.
    expect(
      actions.filter(
        (a) =>
          a.actionKind !== "draft-answer" && a.dispatchStatus === "succeeded",
      ),
    ).toEqual([]);
    expect(actions.map((a) => a.suppressionReason)).toContain("policy_changed");
    expect(after.filter((r) => r.processingPolicy !== "device-only")).toEqual(
      [],
    );
    expect(jobs.rows).toHaveLength(0);
  }, 120_000);
});
