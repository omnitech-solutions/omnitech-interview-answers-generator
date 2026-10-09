// Rehearsal hints derived from Active Session assistance (ADR-0012
// rule:strict-rehearsal-no-assistance, rule:assistance-counts-as-hints,
// rule:no-second-scorecard, rule:tombstone-keeps-hint-count). On a disposable
// PostgreSQL as the application's non-owner role:
//  - a strict start forces live assistance off; a non-strict session's shown
//    drafts are counted as hints on the session row (and survive the purge);
//  - the scorecard save derives the hint count on the server from the owner's
//    own sessions with the run id, adds it to the reveals cost, and does not
//    store it as reveals;
//  - the session code never writes rehearsal_sessions.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_SESSION_HINTS,
  rehearsalScore,
} from "@omnitech/interview-contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceDatabasePort } from "../assistant/workspace";
import {
  type Fixture,
  startFixture,
} from "../live-session/live-session-fixture";
import {
  buildProcessor,
  createFakeEngine,
  ingestorFor,
  settle,
} from "../live-session/processor-fixture";
import { ActiveSessionRepository } from "../live-session/repository";
import { purgeSession } from "../live-session/session-purge";
import { RECRUITER_SCREEN } from "../live-session/session-replay-fixtures";
import { createRehearsalApi } from "./api";

// biome-ignore lint/suspicious/noExplicitAny: JSON read back from the code under test; each assertion names the fields it checks
type Json = any;

let fx: Fixture;
let repo: ActiveSessionRepository;
const cleanups: Array<() => Promise<void>> = [];
const instant = { waitMs: 0, pollMs: 1, sleep: async () => {} };

beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx.stop());

// The rehearsal API as the host mounts it: the tenant and actor come from the
// resolved scope, never from the body.
const database: WorkspaceDatabasePort = {
  tenantTransaction: (tenantId, fn) =>
    fx.member.tenantTransaction(tenantId, (client) =>
      fn({
        query: async (text, values) =>
          (await client.query(text, values ? [...values] : undefined)).rows,
      }),
    ),
};
const api = createRehearsalApi({
  database,
  resolveScope: async (request) => ({
    tenantId: request.headers.get("x-tenant") ?? "",
    actorId: request.headers.get("x-actor") ?? "",
    productId: "omnitech.interview",
  }),
});

const finished = (extra: Record<string, unknown> = {}) => ({
  format: "full",
  strict: false,
  followUps: true,
  concept: { source: "prompt", ref: "react-render", title: "React re-renders" },
  coding: { source: "question", ref: "two-sum", title: "Two sum" },
  checks: [0, 1, 2, 3, 4, 5],
  reveals: ["clarify"],
  activeSeconds: 1800,
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt: "2026-10-01T11:00:00.000Z",
  ...extra,
});
async function save(
  tenant: string,
  actor: string,
  body: Record<string, unknown>,
) {
  const response = await api.request(
    "http://localhost/api/interview/rehearsals",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-tenant": tenant,
        "x-actor": actor,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, Json>,
  };
}
const scorecards = async () =>
  Number(
    (
      await fx.owner.query(
        "SELECT count(*)::int AS n FROM interview.rehearsal_sessions",
      )
    ).rows[0].n,
  );

let runCounter = 0;
const runId = (label: string) => `run-${label}-${++runCounter}`;

async function startRehearsal(
  tenant: string,
  name: string,
  rehearsal: { runId: string; strict: boolean },
  liveAssistance?: boolean,
) {
  const person = await fx.provision(tenant, name);
  const scope = { tenantId: tenant, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "application-audio"],
    rehearsal,
    ...(liveAssistance === undefined ? {} : { liveAssistance }),
  });
  return {
    person,
    scope,
    sessionId: started.session.id,
    credential: started.credential.value,
  };
}
const assistance = async (sessionId: string) =>
  (
    await fx.owner.query(
      "SELECT sources->>'liveAssistance' AS live, shown_draft_count AS shown, strict FROM interview.active_sessions WHERE id=$1",
      [sessionId],
    )
  ).rows[0];

// Runs the real processor over the first recruiter question so a draft is
// produced (and, for a non-strict session, shown).
async function runOneQuestion(world: {
  scope: { tenantId: string; actorId: string };
  sessionId: string;
  credential: string;
}) {
  const processor = buildProcessor(fx, {
    workerId: `worker-${world.sessionId.slice(0, 8)}`,
    engine: createFakeEngine(),
  });
  cleanups.push(() => processor.close());
  const ingestor = ingestorFor(fx, world.scope.tenantId, world.credential);
  for (const segment of RECRUITER_SCREEN[0]?.segments ?? [])
    await ingestor.ingest(segment);
  await settle(processor);
}
const endSession = (world: {
  scope: { tenantId: string; actorId: string };
  sessionId: string;
}) => repo.controlSession(world.scope, world.sessionId, "end");

describe("strict and non-strict session starts", () => {
  it("a strict start forces live assistance off even when asked for", async () => {
    const strict = await startRehearsal(
      fx.tenantA,
      "strict-start",
      { runId: runId("strict"), strict: true },
      true,
    );
    expect(await assistance(strict.sessionId)).toMatchObject({
      live: "false",
      strict: true,
      shown: 0,
    });
    await endSession(strict);

    const open = await startRehearsal(fx.tenantA, "open-start", {
      runId: runId("open"),
      strict: false,
    });
    expect(await assistance(open.sessionId)).toMatchObject({
      live: "true",
      strict: false,
    });
    await endSession(open);
  });

  it("a strict session shows no draft, so it counts no hints", async () => {
    const id = runId("strict-run");
    const world = await startRehearsal(
      fx.tenantA,
      "strict-run",
      { runId: id, strict: true },
      true,
    );
    await runOneQuestion(world);
    expect((await assistance(world.sessionId)).shown).toBe(0);
    await endSession(world);
    const saved = await save(
      world.scope.tenantId,
      world.scope.actorId,
      finished({ strict: true, rehearsalRunId: id }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      score: rehearsalScore(6, 1),
      sessionHints: 0,
    });
  });
});

describe("scorecard hints derived from non-strict sessions", () => {
  it("counts shown drafts as hints, adds them to the reveals cost and does not store them as reveals", async () => {
    const id = runId("hints");
    const world = await startRehearsal(fx.tenantA, "hints", {
      runId: id,
      strict: false,
    });
    await runOneQuestion(world);
    const shown = Number((await assistance(world.sessionId)).shown);
    expect(shown).toBeGreaterThanOrEqual(1);
    await endSession(world);

    const before = await scorecards();
    const saved = await save(
      world.scope.tenantId,
      world.scope.actorId,
      finished({ rehearsalRunId: id }),
    );
    expect(saved.status).toBe(200);
    const expectedHints = Math.min(shown, MAX_SESSION_HINTS);
    expect(saved.body).toMatchObject({
      score: rehearsalScore(6, 1 + expectedHints),
      sessionHints: expectedHints,
      reveals: ["clarify"],
    });
    expect(await scorecards()).toBe(before + 1);
    // The stored scorecard keeps the client's reveals untouched.
    const stored = await fx.owner.query(
      "SELECT value FROM interview.rehearsal_sessions WHERE id=$1",
      [saved.body["id"]],
    );
    expect(stored.rows[0].value.reveals).toEqual(["clarify"]);
  });

  it("the tombstone keeps the count: hints still derive after the purge", async () => {
    const id = runId("tomb");
    const world = await startRehearsal(fx.tenantA, "tomb", {
      runId: id,
      strict: false,
    });
    await runOneQuestion(world);
    const shown = Number((await assistance(world.sessionId)).shown);
    expect(shown).toBeGreaterThanOrEqual(1);
    await endSession(world);
    const purged = await purgeSession(
      fx.member,
      {
        tenantId: world.scope.tenantId,
        ownerUserId: world.scope.actorId,
        sessionId: world.sessionId,
      },
      instant,
    );
    expect(purged.outcome).toBe("complete");
    const tomb = await fx.owner.query(
      "SELECT purged_at, shown_draft_count FROM interview.active_sessions WHERE id=$1",
      [world.sessionId],
    );
    expect(tomb.rows[0].purged_at).not.toBeNull();
    const saved = await save(
      world.scope.tenantId,
      world.scope.actorId,
      finished({ rehearsalRunId: id }),
    );
    expect(saved.body).toMatchObject({
      sessionHints: Math.min(shown, MAX_SESSION_HINTS),
    });
  });

  it("sums the sessions of one run and caps the derived hints", async () => {
    const id = runId("cap");
    const first = await startRehearsal(fx.tenantA, "cap", {
      runId: id,
      strict: false,
    });
    await endSession(first);
    // A second session for the same member and run id.
    const second = await repo.startSession(first.scope, {
      processingPolicy: "permitted-remote",
      captureSources: ["microphone"],
      rehearsal: { runId: id, strict: false },
    });
    await endSession({ scope: first.scope, sessionId: second.session.id });
    await fx.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count = 3 WHERE id=$1",
      [first.sessionId],
    );
    await fx.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count = 2 WHERE id=$1",
      [second.session.id],
    );
    const sum = await save(
      first.scope.tenantId,
      first.scope.actorId,
      finished({ rehearsalRunId: id }),
    );
    expect(sum.body).toMatchObject({
      sessionHints: 5,
      score: rehearsalScore(6, 1 + 5),
    });

    const capId = runId("cap2");
    const big = await startRehearsal(fx.tenantA, "cap2", {
      runId: capId,
      strict: false,
    });
    await endSession(big);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count = 50 WHERE id=$1",
      [big.sessionId],
    );
    const capped = await save(
      big.scope.tenantId,
      big.scope.actorId,
      finished({ rehearsalRunId: capId }),
    );
    expect(capped.body).toMatchObject({
      sessionHints: MAX_SESSION_HINTS,
      score: rehearsalScore(6, 1 + MAX_SESSION_HINTS),
    });
  });

  it("counts nothing when no session matches the run id", async () => {
    const person = await fx.provision(fx.tenantA, "no-match");
    const saved = await save(
      fx.tenantA,
      person.id,
      finished({ rehearsalRunId: runId("nothing") }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      sessionHints: 0,
      score: rehearsalScore(6, 1),
    });
  });

  it("a save without a run id behaves exactly as before", async () => {
    const person = await fx.provision(fx.tenantA, "plain");
    const saved = await save(fx.tenantA, person.id, finished());
    expect(saved.status).toBe(200);
    expect(saved.body["score"]).toBe(rehearsalScore(6, 1));
    expect(saved.body).not.toHaveProperty("sessionHints");
    expect(saved.body).not.toHaveProperty("rehearsalRunId");
  });
});

describe("refusals", () => {
  it("refuses a strictness mismatch with a code and saves nothing", async () => {
    const strictId = runId("mismatch-strict");
    const strict = await startRehearsal(fx.tenantA, "mismatch-s", {
      runId: strictId,
      strict: true,
    });
    await endSession(strict);
    const openId = runId("mismatch-open");
    const open = await startRehearsal(fx.tenantA, "mismatch-o", {
      runId: openId,
      strict: false,
    });
    await endSession(open);

    const before = await scorecards();
    // Claims non-strict against a strict session.
    const a = await save(
      strict.scope.tenantId,
      strict.scope.actorId,
      finished({ strict: false, rehearsalRunId: strictId }),
    );
    expect(a.status).toBe(409);
    expect(a.body).toEqual({
      error: { code: "rehearsal-strictness-mismatch" },
    });
    // Claims strict against a non-strict session that could have helped.
    const b = await save(
      open.scope.tenantId,
      open.scope.actorId,
      finished({ strict: true, rehearsalRunId: openId }),
    );
    expect(b.status).toBe(409);
    expect(b.body).toEqual({
      error: { code: "rehearsal-strictness-mismatch" },
    });
    expect(await scorecards()).toBe(before);
  });

  it("derives once per run id: a second save is refused with a code", async () => {
    const id = runId("once");
    const world = await startRehearsal(fx.tenantA, "once", {
      runId: id,
      strict: false,
    });
    await endSession(world);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count = 2 WHERE id=$1",
      [world.sessionId],
    );
    const first = await save(
      world.scope.tenantId,
      world.scope.actorId,
      finished({ rehearsalRunId: id }),
    );
    expect(first.status).toBe(200);
    expect(first.body["sessionHints"]).toBe(2);
    const before = await scorecards();
    const again = await save(
      world.scope.tenantId,
      world.scope.actorId,
      finished({ rehearsalRunId: id }),
    );
    expect(again.status).toBe(409);
    expect(again.body).toEqual({
      error: { code: "rehearsal-run-already-saved" },
    });
    expect(await scorecards()).toBe(before);
  });

  it("two racing saves for one run id store one scorecard", async () => {
    const id = runId("race");
    const world = await startRehearsal(fx.tenantA, "race", {
      runId: id,
      strict: false,
    });
    await endSession(world);
    const results = await Promise.all([
      save(
        world.scope.tenantId,
        world.scope.actorId,
        finished({ rehearsalRunId: id }),
      ),
      save(
        world.scope.tenantId,
        world.scope.actorId,
        finished({ rehearsalRunId: id }),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("same tenant, another member", () => {
  it("counts nothing for a run id that belongs to someone else", async () => {
    const id = runId("foreign");
    const owner = await startRehearsal(fx.tenantA, "owner", {
      runId: id,
      strict: false,
    });
    await endSession(owner);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count = 4 WHERE id=$1",
      [owner.sessionId],
    );
    const other = await fx.provision(fx.tenantA, "other");
    // The other member saves a scorecard naming the owner's run id: no match
    // in their own sessions, so no hints, and no refusal that leaks existence.
    const saved = await save(
      fx.tenantA,
      other.id,
      finished({ rehearsalRunId: id }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      sessionHints: 0,
      score: rehearsalScore(6, 1),
    });
    // Even a strictness claim that would mismatch the owner's session is not
    // judged against it.
    const strictClaim = await save(
      fx.tenantA,
      other.id,
      finished({ strict: true, rehearsalRunId: `${id}-b` }),
    );
    expect(strictClaim.status).toBe(200);
    // The owner's own derivation is untouched by the other member's save.
    const mine = await save(
      owner.scope.tenantId,
      owner.scope.actorId,
      finished({ rehearsalRunId: id }),
    );
    expect(mine.status).toBe(200);
    expect(mine.body["sessionHints"]).toBe(4);
  });

  it("a session in another tenant with the same run id counts nothing either", async () => {
    const id = runId("tenant");
    const world = await startRehearsal(fx.tenantB, "tenant-b", {
      runId: id,
      strict: false,
    });
    await endSession(world);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET shown_draft_count = 4 WHERE id=$1",
      [world.sessionId],
    );
    const person = await fx.provision(fx.tenantA, "tenant-a");
    const saved = await save(
      fx.tenantA,
      person.id,
      finished({ rehearsalRunId: id }),
    );
    expect(saved.body["sessionHints"]).toBe(0);
  });
});

describe("the session never writes rehearsal_sessions (rule:no-second-scorecard)", () => {
  it("no live-session source touches the rehearsal scorecard table", () => {
    const directory = join(
      dirname(fileURLToPath(import.meta.url)),
      "../live-session",
    );
    const sources = readdirSync(directory, { recursive: true })
      .map(String)
      .filter(
        (name) =>
          name.endsWith(".ts") &&
          !name.endsWith(".test.ts") &&
          // Test support reads the table to prove it is unchanged.
          !name.includes("fixture"),
      );
    expect(sources.length).toBeGreaterThan(20);
    const mentions = sources.filter((name) =>
      /rehearsal_sessions|rehearsalSessions/.test(
        readFileSync(join(directory, name), "utf8"),
      ),
    );
    expect(mentions).toEqual([]);
  });

  it("the scan pattern is not vacuous", () => {
    expect(
      /rehearsal_sessions|rehearsalSessions/.test(
        "INSERT INTO interview.rehearsal_sessions(id) VALUES ($1)",
      ),
    ).toBe(true);
  });

  it("a full session run (start, assist, end, purge) leaves rehearsal_sessions unchanged", async () => {
    const snapshot = async () =>
      (
        await fx.owner.query(
          "SELECT count(*)::int AS n, coalesce(max(ended_at)::text,'') AS latest, md5(coalesce(string_agg(id::text || value::text, ',' ORDER BY id::text), '')) AS digest FROM interview.rehearsal_sessions",
        )
      ).rows[0];
    const before = await snapshot();
    const world = await startRehearsal(fx.tenantA, "no-scorecard", {
      runId: runId("no-scorecard"),
      strict: false,
    });
    await runOneQuestion(world);
    await endSession(world);
    await purgeSession(
      fx.member,
      {
        tenantId: world.scope.tenantId,
        ownerUserId: world.scope.actorId,
        sessionId: world.sessionId,
      },
      instant,
    );
    expect(await snapshot()).toEqual(before);
  });
});
