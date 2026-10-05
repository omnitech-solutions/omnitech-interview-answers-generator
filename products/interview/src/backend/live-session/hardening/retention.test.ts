// Hardening case 7 (PB-0002 slice 3): retention and COMPLETE purge for each
// retention mode. A session is built the way a call builds it - a fixture
// companion through the real routes (transcripts, a screenshot with pixels), the
// real processor (a prose draft, a solution and the session-owned Workspace
// draft), plus a private job with its events, artifact and payload rows. Then
// the retention sweep (the real processor's sweep, as the worker runs it)
// decides: delete-at-end purges at once, thirty-days only after thirty days,
// until-deleted only when the owner deletes. A purged session leaves nothing
// but a content-free tombstone.
import * as fixture from "@omnitech/capture-companion/fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeRunner, QUESTION, scriptedGateway } from "../coding-fixture";
import { PNG_BYTES } from "../live-session-fixture";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  settle,
} from "../processor-fixture";
import { type Started, startWorld, type World } from "./world";

let world: World<typeof fixture>;
beforeAll(async () => {
  world = await startWorld(fixture);
}, 120_000);
afterAll(() => world?.stop());

const CANARY_TEXT = "Retention canary: a rate limiter for a Node service.";
const rows = async (sql: string, values: unknown[] = []) =>
  (await world.fx.owner.query(sql, values)).rows;

type Built = { owner: Started; jobId: string; refs: string[]; runtime: string };

// A session with every kind of data a session can hold.
async function build(
  name: string,
  retention: "delete-at-end" | "thirty-days" | "until-deleted",
): Promise<Built> {
  const { fx } = world;
  const owner = await world.begin(name, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "application-audio", "screen"],
    retention,
  });
  const run = world.companion(owner, {
    sources: ["microphone", "application-audio", "screen"],
  });
  await run.open();
  await run.companion.observeTranscript({
    eventId: QUESTION.eventId,
    source: "application-audio",
    text: `${QUESTION.text} ${CANARY_TEXT}`,
    startMs: QUESTION.startMs,
    endMs: QUESTION.endMs,
  });
  await run.companion.observeScreenshot({
    payload: PNG_BYTES,
    mediaType: "image/png",
    windowLabel: "Retention window label",
  });
  expect(run.companion.pending).toBe(0);

  // The real processor: a prose draft, then a tested solution, published into
  // the session-owned Workspace draft.
  const { runner } = fakeRunner();
  const gateway = scriptedGateway();
  const processor = buildProcessor(fx, {
    workerId: `worker-retention-${name}`,
    gateway,
    codeRunner: runner,
  });
  await settle(processor);
  await processor.close();

  // A private job with its events, artifact and payload rows (arranged as the
  // fixture owner; the processor of this loop creates none).
  const refs = ["prompt", "result", "artifact"].map(
    (kind) => `agent-payload:${owner.id}-${kind}`,
  );
  for (const reference of refs)
    await fx.owner.query(
      "INSERT INTO ai.agent_job_payloads(reference,tenant_id,ciphertext,expires_at) VALUES($1,$2,'\"x\"', now() + interval '1 day')",
      [reference, fx.tenantA],
    );
  const runtime = `runtime-${owner.id}`;
  await fx.owner.query(
    "INSERT INTO ai.agent_sessions(tenant_id,user_id,runtime,runtime_session_id,profile_snapshot,status) VALUES($1,$2,'codex',$3,'{}','open')",
    [fx.tenantA, owner.person.id, runtime],
  );
  const jobId = await fx.pg.owner.transaction(async (client) => {
    await client.query(
      "SELECT set_config('app.session_dispatch','on',true), set_config('app.actor_id',$1,true)",
      [owner.person.id],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai.agent_jobs(tenant_id,user_id,product_id,status,profile_snapshot,prompt_reference,result_reference,private,session_id)
       VALUES($1,$2,'omnitech.interview','succeeded','{}',$3,$4,true,$5) RETURNING id`,
      [fx.tenantA, owner.person.id, refs[0], refs[1], runtime],
    );
    return String(result.rows[0]?.id);
  });
  await fx.owner.query(
    'INSERT INTO ai.agent_job_events(tenant_id,job_id,sequence,event) VALUES($1,$2,1,\'{"type":"x"}\'),($1,$2,2,\'{"type":"y"}\')',
    [fx.tenantA, jobId],
  );
  await fx.owner.query(
    "INSERT INTO ai.agent_artifacts(tenant_id,job_id,artifact_reference,kind) VALUES($1,$2,$3,'patch')",
    [fx.tenantA, jobId, refs[2]],
  );
  await fx.owner.query(
    `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created,dispatch_status,result,shown)
     VALUES($1,$2,$3,'job-task',1,'repair',1,$4,true,'succeeded','{"text":"job draft"}',false)`,
    [fx.tenantA, owner.person.id, owner.id, jobId],
  );
  return { owner, jobId, refs, runtime };
}

// Everything a session can leave behind, counted. Every count is a row that
// belongs to this session; none of it may survive a purge.
async function residue(built: Built) {
  const { owner, jobId, refs, runtime } = built;
  const id = owner.id;
  const count = async (sql: string, values: unknown[]) =>
    Number((await rows(sql, values))[0]?.n);
  return {
    observations: await count(
      "SELECT count(*) AS n FROM interview.session_observations WHERE session_id=$1",
      [id],
    ),
    actions: await count(
      "SELECT count(*) AS n FROM interview.session_actions WHERE session_id=$1",
      [id],
    ),
    // Derived context: results and claims live on the actions; counted apart.
    derivedResults: await count(
      "SELECT count(*) AS n FROM interview.session_actions WHERE session_id=$1 AND result IS NOT NULL",
      [id],
    ),
    sessionDrafts: await count(
      "SELECT count(*) AS n FROM interview.assistant_drafts WHERE workspace_id=$1",
      [`active-session:${id}`],
    ),
    screenshotArtifacts: await count(
      "SELECT count(*) AS n FROM platform.artifacts WHERE metadata->>'session_id'=$1",
      [id],
    ),
    artifactPayloads: await count(
      "SELECT count(*) AS n FROM platform.artifact_payloads p JOIN platform.artifacts a ON a.id=p.artifact_id AND a.tenant_id=p.tenant_id WHERE a.metadata->>'session_id'=$1",
      [id],
    ),
    jobs: await count("SELECT count(*) AS n FROM ai.agent_jobs WHERE id=$1", [
      jobId,
    ]),
    jobEvents: await count(
      "SELECT count(*) AS n FROM ai.agent_job_events WHERE job_id=$1",
      [jobId],
    ),
    jobArtifacts: await count(
      "SELECT count(*) AS n FROM ai.agent_artifacts WHERE job_id=$1",
      [jobId],
    ),
    jobPayloads: await count(
      "SELECT count(*) AS n FROM ai.agent_job_payloads WHERE reference = ANY($1::text[])",
      [refs],
    ),
    agentSessions: await count(
      "SELECT count(*) AS n FROM ai.agent_sessions WHERE runtime_session_id=$1",
      [runtime],
    ),
  };
}

// A catalog sweep, so a table added later that references a session cannot be
// forgotten: every column named session_id in the interview schema, any row
// naming this session. (The purge's own final check does the same.)
async function sessionIdRows(id: string): Promise<string[]> {
  const columns = await rows(
    `SELECT table_schema, table_name FROM information_schema.columns
     WHERE column_name = 'session_id' AND table_schema = 'interview'
       AND data_type IN ('uuid','text')`,
  );
  const left: string[] = [];
  for (const column of columns) {
    const n = Number(
      (
        await rows(
          `SELECT count(*) AS n FROM ${column.table_schema}.${column.table_name} WHERE session_id::text = $1`,
          [id],
        )
      )[0]?.n,
    );
    if (n > 0) left.push(`${column.table_name}:${n}`);
  }
  return left;
}

// One run of the worker's retention sweep, as the real processor does it.
async function sweep(): Promise<void> {
  const gateway = createFakeGateway();
  const processor = buildProcessor(world.fx, {
    workerId: `worker-sweep-${Math.random().toString(36).slice(2, 8)}`,
    gateway,
    sweeps: true,
  });
  await processor.tick(NEVER_ABORTED);
  await processor.idle();
  await processor.close();
}

const end = async (owner: Started) => {
  world.as(owner.person);
  const response = await world.send(`/${owner.id}/control`, {
    version: 1,
    kind: "session.control",
    action: "end",
  });
  expect(response.status).toBe(200);
};
const backdateEnd = (owner: Started, days: number) =>
  world.fx.owner.query(
    "UPDATE interview.active_sessions SET ended_at = now() - ($2 * interval '1 day') WHERE id=$1",
    [owner.id, days],
  );
const tombstoneOf = async (owner: Started) =>
  (
    await rows("SELECT * FROM interview.active_sessions WHERE id=$1", [
      owner.id,
    ])
  )[0];

function expectEverythingThere(before: Awaited<ReturnType<typeof residue>>) {
  // Non-vacuous: each kind of data really exists before the purge.
  expect(before.observations).toBeGreaterThanOrEqual(2);
  expect(before.actions).toBeGreaterThanOrEqual(3);
  expect(before.derivedResults).toBeGreaterThanOrEqual(2);
  expect(before.sessionDrafts).toBeGreaterThanOrEqual(1);
  expect(before.screenshotArtifacts).toBe(1);
  expect(before.artifactPayloads).toBe(1);
  expect(before.jobs).toBe(1);
  expect(before.jobEvents).toBe(2);
  expect(before.jobArtifacts).toBe(1);
  expect(before.jobPayloads).toBe(3);
  expect(before.agentSessions).toBe(1);
}
const ZERO = {
  observations: 0,
  actions: 0,
  derivedResults: 0,
  sessionDrafts: 0,
  screenshotArtifacts: 0,
  artifactPayloads: 0,
  jobs: 0,
  jobEvents: 0,
  jobArtifacts: 0,
  jobPayloads: 0,
  agentSessions: 0,
};

async function expectContentFreeTombstone(owner: Started) {
  const tomb = await tombstoneOf(owner);
  expect(tomb).toMatchObject({
    status: "ended",
    owner_user_id: owner.person.id,
    purge_outcome: "complete",
    credential_hash: null,
    sources: null,
    interview_id: null,
    candidacy_id: null,
    profile_id: null,
    workspace_draft_id: null,
  });
  expect(tomb.purged_at).not.toBeNull();
  const text = JSON.stringify(tomb);
  for (const planted of [
    CANARY_TEXT,
    "Retention window label",
    "rate limiter",
    owner.credential,
  ])
    expect(text).not.toContain(planted);
  // The owner's own read now shows an ended session with nothing in it.
  const page = await world.page(owner);
  expect(page.session.status).toBe("ended");
  expect(page.observations).toEqual([]);
  expect(page.actions).toEqual([]);
}

describe("retention modes decide when the sweep purges", () => {
  it("delete-at-end: purged by the next sweep after the end, leaving only a tombstone", async () => {
    const built = await build("retention-end", "delete-at-end");
    const before = await residue(built);
    expectEverythingThere(before);
    // Still open: the sweep leaves a live session alone.
    await sweep();
    expect(await residue(built)).toEqual(before);

    await end(built.owner);
    await sweep();
    expect(await residue(built)).toEqual(ZERO);
    expect(await sessionIdRows(built.owner.id)).toEqual([]);
    await expectContentFreeTombstone(built.owner);
  }, 90_000);

  it("thirty-days: kept through day 29, purged after day 30", async () => {
    const built = await build("retention-30", "thirty-days");
    const before = await residue(built);
    expectEverythingThere(before);
    await end(built.owner);

    await sweep();
    expect(await residue(built)).toEqual(before);
    await backdateEnd(built.owner, 29);
    await sweep();
    expect(await residue(built)).toEqual(before);
    expect((await tombstoneOf(built.owner)).purged_at).toBeNull();

    await backdateEnd(built.owner, 31);
    await sweep();
    expect(await residue(built)).toEqual(ZERO);
    await expectContentFreeTombstone(built.owner);
  }, 90_000);

  it("until-deleted: never purged by time, purged when the owner deletes", async () => {
    const built = await build("retention-keep", "until-deleted");
    const before = await residue(built);
    expectEverythingThere(before);
    await end(built.owner);
    await backdateEnd(built.owner, 400);
    await sweep();
    expect(await residue(built)).toEqual(before);
    expect((await tombstoneOf(built.owner)).purged_at).toBeNull();

    // The owner's delete, through the real route, begins the purge.
    world.as(built.owner.person);
    const deleted = await world.send(`/${built.owner.id}`, undefined, "DELETE");
    expect(deleted.status).toBe(202);
    await sweep();
    expect(await residue(built)).toEqual(ZERO);
    expect(await sessionIdRows(built.owner.id)).toEqual([]);
    await expectContentFreeTombstone(built.owner);
  }, 90_000);
});

describe("completeness against the catalog", () => {
  it("has no relay table to purge: the on-device model relay is not built (unobserved)", async () => {
    // Relay rows are named by the assignment's purge list, but no relay table
    // exists in any schema. If one is ever added this fails, and the purge's
    // coverage (and this suite's residue()) must grow to include it.
    const relay = await rows(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
       WHERE table_schema IN ('interview','ai','platform') AND table_name ILIKE '%relay%'`,
    );
    expect(relay).toEqual([]);
  });
});
