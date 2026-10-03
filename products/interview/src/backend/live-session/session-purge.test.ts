// The complete session purge (rule:complete-session-purge) on a disposable
// PostgreSQL as the member role: observations, screenshot artifacts and
// payloads, actions, jobs with events, artifacts and payloads are all deleted in
// one transaction; the final check reads the catalog and refuses to tombstone
// when a table that references a session or a job is not covered; the purge is
// idempotent and a crash resumes at the next sweep. The relay rows of the
// on-device model are out of scope this loop: none exist yet.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestObservation } from "./ingest.js";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  screenshot,
  startFixture,
  transcript,
} from "./live-session-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { claimCapExpired, claimPurgeCandidates } from "./session-claim.js";
import { purgeSession, type SessionDraftPurger } from "./session-purge.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });
const target = (person: Person, id: string) => ({
  tenantId: tenant,
  ownerUserId: person.id,
  sessionId: id,
});
const instant = { waitMs: 0, pollMs: 1, sleep: async () => {} };

async function seeded(name: string, extra: Record<string, unknown> = {}) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
    candidacyId: person.candidacy,
    interviewId: person.interview,
    profile: { id: person.profile },
    ...extra,
  } as never);
  const id = started.session.id;
  const credential = started.credential.value;
  await ingestObservation(
    fx.member,
    credential,
    tenant,
    transcript("mic", 0, "words", `${name}-t1`),
  );
  await ingestObservation(
    fx.member,
    credential,
    tenant,
    screenshot("scr", 1, "image/png", PNG_BYTES.byteLength, `${name}-s1`),
    { payload: PNG_BYTES },
  );
  return { person, id, credential };
}

// An action with a real private job, its events, artifacts and payloads.
async function withJob(
  person: Person,
  id: string,
  kind: string,
  status = "succeeded",
) {
  const refs = {
    prompt: `agent-payload:${id}-${kind}-prompt`,
    result: `agent-payload:${id}-${kind}-result`,
    artifact: `agent-payload:${id}-${kind}-artifact`,
  };
  for (const reference of Object.values(refs))
    await fx.owner.query(
      "INSERT INTO ai.agent_job_payloads(reference,tenant_id,ciphertext,expires_at) VALUES($1,$2,'\"x\"', now() + interval '1 day')",
      [reference, tenant],
    );
  const runtime = `runtime-${kind}-${id}`;
  await fx.owner.query(
    "INSERT INTO ai.agent_sessions(tenant_id,user_id,runtime,runtime_session_id,profile_snapshot,status) VALUES($1,$2,'codex',$3,'{}','open')",
    [tenant, person.id, runtime],
  );
  const jobId = await fx.pg.owner.transaction(async (client) => {
    await client.query(
      "SELECT set_config('app.session_dispatch','on',true), set_config('app.actor_id',$1,true)",
      [person.id],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai.agent_jobs(tenant_id,user_id,product_id,status,profile_snapshot,prompt_reference,result_reference,private,session_id)
       VALUES($1,$2,'omnitech.interview',$3,'{}',$4,$5,true,$6) RETURNING id`,
      [tenant, person.id, status, refs.prompt, refs.result, runtime],
    );
    return String(result.rows[0]?.id);
  });
  await fx.owner.query(
    'INSERT INTO ai.agent_job_events(tenant_id,job_id,sequence,event) VALUES($1,$2,1,\'{"type":"x"}\'),($1,$2,2,\'{"type":"y"}\')',
    [tenant, jobId],
  );
  await fx.owner.query(
    "INSERT INTO ai.agent_artifacts(tenant_id,job_id,artifact_reference,kind) VALUES($1,$2,$3,'patch')",
    [tenant, jobId, refs.artifact],
  );
  await fx.owner.query(
    `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created,dispatch_status,result,shown)
     VALUES($1,$2,$3,'t1',1,$4,1,$5,true,'succeeded','{"text":"draft"}',$6)`,
    [tenant, person.id, id, kind, jobId, kind === "repair"],
  );
  return { jobId, refs, runtime };
}

const rows = async (sql: string, values: unknown[]) =>
  (await fx.owner.query(sql, values)).rows;

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

describe("purge removes everything and leaves a content-free tombstone", () => {
  it("deletes observations, screenshots, actions, jobs and their payloads, then tombstones", async () => {
    const { person, id } = await seeded("amy", {
      rehearsal: { runId: "run-9", strict: false },
    });
    const job = await withJob(person, id, "repair");
    await withJob(person, id, "answer");
    // Another member's session and job must survive untouched.
    const bystander = await seeded("bo");
    const kept = await withJob(bystander.person, bystander.id, "repair");

    expect(
      await rows(
        "SELECT 1 FROM interview.session_observations WHERE session_id=$1",
        [id],
      ),
    ).toHaveLength(2);
    expect(
      await rows(
        "SELECT 1 FROM platform.artifacts WHERE metadata->>'session_id'=$1",
        [id],
      ),
    ).toHaveLength(1);

    const result = await purgeSession(fx.member, target(person, id), instant);
    expect(result).toMatchObject({
      outcome: "complete",
      counts: {
        observations: 2,
        screenshotArtifacts: 1,
        actions: 2,
        jobs: 2,
        jobEvents: 4,
        jobArtifacts: 2,
        agentSessions: 2,
      },
    });

    for (const [sql, values] of [
      [
        "SELECT 1 FROM interview.session_observations WHERE session_id=$1",
        [id],
      ],
      ["SELECT 1 FROM interview.session_actions WHERE session_id=$1", [id]],
      [
        "SELECT 1 FROM platform.artifacts WHERE metadata->>'session_id'=$1",
        [id],
      ],
      ["SELECT 1 FROM ai.agent_jobs WHERE id=$1", [job.jobId]],
      ["SELECT 1 FROM ai.agent_job_events WHERE job_id=$1", [job.jobId]],
      ["SELECT 1 FROM ai.agent_artifacts WHERE job_id=$1", [job.jobId]],
      [
        "SELECT 1 FROM ai.agent_job_payloads WHERE reference = ANY($1::text[])",
        [Object.values(job.refs)],
      ],
      [
        "SELECT 1 FROM ai.agent_sessions WHERE runtime_session_id=$1",
        [job.runtime],
      ],
    ] as const)
      expect(await rows(sql, [...values] as unknown[]), sql).toHaveLength(0);
    expect(
      await rows(
        "SELECT 1 FROM platform.artifact_payloads WHERE tenant_id=$1",
        [tenant],
      ),
    ).toHaveLength(1); // only the bystander's screenshot

    const tomb = (
      await rows("SELECT * FROM interview.active_sessions WHERE id=$1", [id])
    )[0];
    expect(tomb).toMatchObject({
      status: "ended",
      owner_user_id: person.id,
      rehearsal_run_id: "run-9",
      strict: false,
      purge_outcome: "complete",
      credential_hash: null,
      sources: null,
      interview_id: null,
      candidacy_id: null,
      profile_id: null,
      workspace_draft_id: null,
      shown_draft_count: 1,
    });
    expect(tomb.purged_at).not.toBeNull();
    expect(tomb.purge_counts).toMatchObject({ observations: 2 });
    // The tombstone carries counts and ids, no text.
    expect(JSON.stringify(tomb)).not.toContain("words");

    // The bystander is whole.
    expect(
      await rows(
        "SELECT 1 FROM interview.session_observations WHERE session_id=$1",
        [bystander.id],
      ),
    ).toHaveLength(2);
    expect(
      await rows("SELECT 1 FROM ai.agent_jobs WHERE id=$1", [kept.jobId]),
    ).toHaveLength(1);
    expect(
      await rows("SELECT 1 FROM ai.agent_job_payloads WHERE reference=$1", [
        kept.refs.prompt,
      ]),
    ).toHaveLength(1);
  });

  it("is idempotent: a second purge changes nothing", async () => {
    const { person, id } = await seeded("cy");
    expect(
      (await purgeSession(fx.member, target(person, id), instant)).outcome,
    ).toBe("complete");
    const before = (
      await rows("SELECT * FROM interview.active_sessions WHERE id=$1", [id])
    )[0];
    expect(await purgeSession(fx.member, target(person, id), instant)).toEqual({
      outcome: "already-purged",
    });
    expect(
      (
        await rows("SELECT * FROM interview.active_sessions WHERE id=$1", [id])
      )[0],
    ).toEqual(before);
  });

  it("resolves two racing purges to one complete purge", async () => {
    const { person, id } = await seeded("dee");
    const outcomes = await Promise.all([
      purgeSession(fx.member, target(person, id), instant),
      purgeSession(fx.member, target(person, id), instant),
    ]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual([
      "already-purged",
      "complete",
    ]);
  });

  it("refuses ingest from the moment the session is purging", async () => {
    const { person, id, credential } = await seeded("eli");
    await repo.deleteSession(scopeOf(person), id);
    expect(
      (
        await ingestObservation(
          fx.member,
          credential,
          tenant,
          transcript("mic", 5, "late", "late-1"),
        )
      ).status,
    ).toBe("refused");
    expect(
      await rows(
        "SELECT 1 FROM interview.session_observations WHERE session_id=$1",
        [id],
      ),
    ).toHaveLength(2);
    // The owner's delete is then completed by the purge, as the owner.
    expect(
      (
        await purgeSession(fx.member, target(person, id), {
          ...instant,
          trigger: "owner-delete",
        })
      ).outcome,
    ).toBe("complete");
    expect(
      await rows(
        "SELECT 1 FROM interview.session_observations WHERE session_id=$1",
        [id],
      ),
    ).toHaveLength(0);
  });

  it("records a partial outcome when a named job never became terminal, and still deletes it", async () => {
    const { person, id } = await seeded("fin");
    const job = await withJob(person, id, "repair", "running");
    const result = await purgeSession(fx.member, target(person, id), instant);
    expect(result.outcome).toBe("partial");
    expect(
      await rows("SELECT 1 FROM ai.agent_jobs WHERE id=$1", [job.jobId]),
    ).toHaveLength(0);
    expect(
      (
        await rows(
          "SELECT purge_outcome FROM interview.active_sessions WHERE id=$1",
          [id],
        )
      )[0]?.purge_outcome,
    ).toBe("partial");
  });

  it("waits for the named jobs to be terminal before deleting them", async () => {
    const { person, id } = await seeded("gil");
    const job = await withJob(person, id, "repair", "running");
    let slept = 0;
    const result = await purgeSession(fx.member, target(person, id), {
      waitMs: 100,
      pollMs: 10,
      sleep: async () => {
        slept += 1;
        // The worker finishes the cancelled job while the purge waits.
        await fx.owner.query(
          "UPDATE ai.agent_jobs SET status='cancelled' WHERE id=$1",
          [job.jobId],
        );
      },
    });
    expect(slept).toBe(1);
    expect(result.outcome).toBe("complete");
  });

  it("hands the session's draft key to the draft purger inside the purge", async () => {
    const hal = await fx.provision(tenant, "hal");
    await fx.owner.query(
      "INSERT INTO interview.assistant_drafts(tenant_id,actor_id,product_id,workspace_id,artifact_id,value) VALUES($1,$2,'omnitech.interview','ws','art','{}')",
      [tenant, hal.id],
    );
    const started = await repo.startSession(scopeOf(hal), {
      processingPolicy: "device-only",
      captureSources: ["microphone"],
      workspaceDraft: { workspaceId: "ws", artifactId: "art" },
    });
    const seen: unknown[] = [];
    const drafts: SessionDraftPurger = {
      purge: async (_client, _target, key) => {
        seen.push(key);
        return 1;
      },
    };
    const result = await purgeSession(
      fx.member,
      target(hal, started.session.id),
      { ...instant, drafts },
    );
    expect(seen).toEqual([{ workspaceId: "ws", artifactId: "art" }]);
    expect(result).toMatchObject({ counts: { drafts: 1 } });
    // The default purger leaves the draft: a draft outside the purge stays.
    expect(
      await rows("SELECT 1 FROM interview.assistant_drafts WHERE actor_id=$1", [
        hal.id,
      ]),
    ).toHaveLength(1);
  });
});

describe("the final check (rule:complete-session-purge)", () => {
  it("fails and does not tombstone while an uncovered table references the session", async () => {
    const { person, id } = await seeded("ivy");
    await fx.owner.query(`
      CREATE TABLE interview.zz_session_probe(
        tenant_id uuid NOT NULL, owner_user_id uuid NOT NULL, session_id uuid NOT NULL, note text,
        FOREIGN KEY (tenant_id, owner_user_id, session_id)
          REFERENCES interview.active_sessions(tenant_id, owner_user_id, id));
      GRANT SELECT, INSERT, UPDATE, DELETE ON interview.zz_session_probe TO fixture_member;`);
    try {
      await expect(
        purgeSession(fx.member, target(person, id), instant),
      ).rejects.toMatchObject({
        code: "purge_incomplete",
        uncoveredTables: ["interview.zz_session_probe"],
      });
      const row = (
        await rows(
          "SELECT status, purged_at, purge_outcome FROM interview.active_sessions WHERE id=$1",
          [id],
        )
      )[0];
      expect(row).toMatchObject({
        status: "purging",
        purged_at: null,
        purge_outcome: null,
      });
      // The whole transaction rolled back: nothing is half-purged, so the next
      // sweep starts clean once the uncovered table is handled.
      expect(
        await rows(
          "SELECT 1 FROM interview.session_observations WHERE session_id=$1",
          [id],
        ),
      ).toHaveLength(2);
    } finally {
      await fx.owner.query("DROP TABLE interview.zz_session_probe");
    }
    expect(
      (await purgeSession(fx.member, target(person, id), instant)).outcome,
    ).toBe("complete");
  });

  it("fails while an uncovered table references one of the session's jobs", async () => {
    const { person, id } = await seeded("jay");
    await withJob(person, id, "repair");
    await fx.owner.query(`
      CREATE TABLE ai.zz_job_probe(
        tenant_id uuid NOT NULL, job_id uuid NOT NULL,
        FOREIGN KEY (tenant_id, job_id) REFERENCES ai.agent_jobs(tenant_id, id) ON DELETE CASCADE);
      GRANT SELECT, INSERT, UPDATE, DELETE ON ai.zz_job_probe TO fixture_member;`);
    try {
      await expect(
        purgeSession(fx.member, target(person, id), instant),
      ).rejects.toMatchObject({
        code: "purge_incomplete",
        uncoveredTables: ["ai.zz_job_probe"],
      });
      expect(
        (
          await rows(
            "SELECT purged_at FROM interview.active_sessions WHERE id=$1",
            [id],
          )
        )[0]?.purged_at,
      ).toBeNull();
    } finally {
      await fx.owner.query("DROP TABLE ai.zz_job_probe");
    }
    expect(
      (await purgeSession(fx.member, target(person, id), instant)).outcome,
    ).toBe("complete");
  });

  it("fails when content still remains in a covered table after the deletes", async () => {
    const { person, id } = await seeded("kit");
    await withJob(person, id, "answer");
    // A delete that silently skips a row (a trigger returning NULL) leaves
    // content behind; the count in the final check catches it.
    await fx.owner.query(`
      CREATE OR REPLACE FUNCTION interview.zz_hold_action() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$;
      CREATE TRIGGER zz_hold BEFORE DELETE ON interview.session_actions
        FOR EACH ROW EXECUTE FUNCTION interview.zz_hold_action();`);
    try {
      await expect(
        purgeSession(fx.member, target(person, id), instant),
      ).rejects.toMatchObject({ code: "purge_incomplete" });
      expect(
        (
          await rows(
            "SELECT purged_at FROM interview.active_sessions WHERE id=$1",
            [id],
          )
        )[0]?.purged_at,
      ).toBeNull();
    } finally {
      await fx.owner.query("DROP TRIGGER zz_hold ON interview.session_actions");
    }
    expect(
      (await purgeSession(fx.member, target(person, id), instant)).outcome,
    ).toBe("complete");
  });
});

describe("the purge sweep claim", () => {
  it("returns ids only for ended delete-at-end, purging and retention-expired sessions", async () => {
    const make = async (name: string, retention: string) => {
      const s = await seeded(name, { retention });
      return s;
    };
    const deleteAtEnd = await make("lan", "delete-at-end");
    const thirtyOld = await make("mia", "thirty-days");
    const thirtyNew = await make("ned", "thirty-days");
    const untilDeleted = await make("oz", "until-deleted");
    const purging = await make("pia", "until-deleted");
    const open = await make("qi", "delete-at-end");
    for (const s of [deleteAtEnd, thirtyOld, thirtyNew, untilDeleted])
      await repo.controlSession(scopeOf(s.person), s.id, "end");
    await repo.deleteSession(scopeOf(purging.person), purging.id);
    await fx.owner.query(
      "UPDATE interview.active_sessions SET ended_at = now() - interval '31 days' WHERE id=$1",
      [thirtyOld.id],
    );
    await fx.owner.query(
      "UPDATE interview.active_sessions SET ended_at = now() - interval '29 days' WHERE id=$1",
      [thirtyNew.id],
    );

    const found = await claimPurgeCandidates(fx.member, 100);
    const ids = found.map((c) => c.sessionId);
    expect(ids).toEqual(
      expect.arrayContaining([deleteAtEnd.id, thirtyOld.id, purging.id]),
    );
    for (const excluded of [thirtyNew, untilDeleted, open])
      expect(ids).not.toContain(excluded.id);
    for (const claim of found)
      expect(Object.keys(claim).sort()).toEqual([
        "ownerUserId",
        "sessionId",
        "tenantId",
      ]);

    // Sweeping completes every one; tombstones then leave the sweep.
    for (const claim of found.filter((c) =>
      [deleteAtEnd.id, thirtyOld.id, purging.id].includes(c.sessionId),
    ))
      await purgeSession(fx.member, claim, instant);
    const after = (await claimPurgeCandidates(fx.member, 100)).map(
      (c) => c.sessionId,
    );
    for (const done of [deleteAtEnd, thirtyOld, purging])
      expect(after).not.toContain(done.id);
  });

  it("finds open sessions past their duration cap", async () => {
    const rae = await fx.provision(tenant, "rae");
    const id = await fx.one(
      "INSERT INTO interview.active_sessions(tenant_id,owner_user_id,processing_policy,status,expires_at) VALUES($1,$2,'permitted_remote','active',now() - interval '1 minute') RETURNING id",
      [tenant, rae.id],
    );
    const found = await claimCapExpired(fx.member, 100);
    expect(found.find((c) => c.sessionId === id)).toEqual({
      tenantId: tenant,
      ownerUserId: rae.id,
      sessionId: id,
    });
    await repo.reconcileSession(scopeOf(rae), id);
    expect(
      (await claimCapExpired(fx.member, 100)).some((c) => c.sessionId === id),
    ).toBe(false);
  });
});
