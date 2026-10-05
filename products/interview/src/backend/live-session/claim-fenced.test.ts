// The worker's claim, lease and fence, and the fenced persistence port, on a
// disposable PostgreSQL as the member role: the claim returns ids and a fence
// only; an older holder is refused after a newer fence or an expired lease; a
// late publish after pause, end or a newer revision is suppressed; dispatch
// dedups by session, task, revision and action kind; the job id is committed
// before the job exists; job creation and resume are locked to the active
// session; pause and end cancel in-flight jobs and fail closed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskState } from "./core/index";
import { SessionError } from "./errors";
import {
  createSessionJob,
  FencedSessionWrites,
  reserveJobId,
  resumeSessionJob,
  sessionJobResumeGuard,
} from "./fenced-writes";
import {
  type Fixture,
  type Person,
  startFixture,
} from "./live-session-fixture";
import { ActiveSessionRepository } from "./repository";
import {
  claimSessions,
  releaseLease,
  renewLease,
  type SessionClaim,
} from "./session-claim";

let fx: Fixture;
let repo: ActiveSessionRepository;
let writes: FencedSessionWrites;
let tenant = "";

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });

async function active(name: string) {
  const person = await fx.provision(tenant, name);
  const { session } = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone"],
  });
  return { person, scope: scopeOf(person), id: session.id };
}

// Claims every free session and returns the claim for one of them.
async function claimFor(id: string, worker: string): Promise<SessionClaim> {
  const claims = await claimSessions(fx.member, worker, 60_000, 500);
  const claim = claims.find((c) => c.sessionId === id);
  if (!claim) throw new Error("expected a claim for the session");
  return claim;
}

const expireLease = (id: string) =>
  fx.owner.query(
    "UPDATE interview.active_sessions SET lease_expires_at = now() - interval '1 second' WHERE id=$1",
    [id],
  );

const holderOf = (worker: string, claim: SessionClaim) => ({
  workerId: worker,
  fence: claim.fence,
});

// A task state the core's dispatch and publish decisions read.
const tasks = (taskId: string, revision: number): TaskState => ({
  tasks: {
    [taskId]: {
      taskId,
      taskKey: `key-${taskId}`,
      revision,
      revisions: Array.from({ length: revision }, (_, index) => ({
        revision: index + 1,
        basedOn: [],
        reason: index === 0 ? ("opened" as const) : ("follow_up" as const),
        sourceSuperseded: false,
      })),
    },
  },
  byKey: { [`key-${taskId}`]: taskId },
  deferred: {},
});

async function actionRows(id: string) {
  return (
    await fx.owner.query(
      "SELECT * FROM interview.session_actions WHERE session_id=$1 ORDER BY created_at, id",
      [id],
    )
  ).rows;
}

async function insertJob(
  owner: Person,
  status = "running",
  runtimeSession: string | null = null,
) {
  return fx.pg.owner.transaction(async (client) => {
    await client.query(
      "SELECT set_config('app.session_dispatch','on',true), set_config('app.actor_id',$1,true)",
      [owner.id],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO ai.agent_jobs(tenant_id,user_id,product_id,status,profile_snapshot,prompt_reference,private,session_id)
       VALUES($1,$2,'omnitech.interview',$3,'{}','agent-payload:x',true,$4) RETURNING id`,
      [tenant, owner.id, status, runtimeSession],
    );
    return String(result.rows[0]?.id);
  });
}

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
  writes = new FencedSessionWrites(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

describe("the claim (rule:session-claim-setting, rule:claim-writes-lease-and-fence-only)", () => {
  it("returns ids and the granted fence only, and raises the fence on every acquire", async () => {
    const { person, id } = await active("ada");
    const claims = await claimSessions(fx.member, "worker-1", 60_000, 500);
    const mine = claims.find((c) => c.sessionId === id);
    expect(mine).toBeDefined();
    expect(Object.keys(mine ?? {}).sort()).toEqual([
      "fence",
      "ownerUserId",
      "sessionId",
      "tenantId",
    ]);
    expect(mine).toMatchObject({
      tenantId: tenant,
      ownerUserId: person.id,
      sessionId: id,
      fence: 1,
    });
    // Held: not claimed again by anyone while the lease is live.
    expect(
      (await claimSessions(fx.member, "worker-2", 60_000, 500)).some(
        (c) => c.sessionId === id,
      ),
    ).toBe(false);
    await expireLease(id);
    expect((await claimFor(id, "worker-2")).fence).toBe(2);
    await expireLease(id);
    expect((await claimFor(id, "worker-1")).fence).toBe(3);
    const row = await fx.owner.query(
      "SELECT fence, lease_holder_id FROM interview.active_sessions WHERE id=$1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      fence: "3",
      lease_holder_id: "worker-1",
    });
  });

  it("lets a restarted worker outrank its earlier self under the same id", async () => {
    const { id } = await active("bea");
    const first = await claimFor(id, "worker-r");
    expect(
      (await claimSessions(fx.member, "worker-r", 60_000, 500)).some(
        (c) => c.sessionId === id,
      ),
    ).toBe(false);
    const again = (
      await claimSessions(fx.member, "worker-r", 60_000, 500, {
        includeOwnLive: true,
      })
    ).find((c) => c.sessionId === id);
    expect(again?.fence).toBe(first.fence + 1);
  });

  it("claims only active sessions", async () => {
    const paused = await active("cid");
    await repo.controlSession(paused.scope, paused.id, "pause");
    const ended = await active("dot");
    await repo.controlSession(ended.scope, ended.id, "end");
    const claims = await claimSessions(fx.member, "worker-x", 60_000, 500);
    expect(
      claims.some((c) => c.sessionId === paused.id || c.sessionId === ended.id),
    ).toBe(false);
  });

  it("renews the lease only for the current holder and fence", async () => {
    const { id } = await active("eve");
    const claim = await claimFor(id, "worker-a");
    expect(await renewLease(fx.member, claim, "worker-a", 60_000)).toEqual({
      renewed: true,
    });
    expect(await renewLease(fx.member, claim, "worker-b", 60_000)).toEqual({
      renewed: false,
      reason: "not_holder",
    });
    await expireLease(id);
    expect(await renewLease(fx.member, claim, "worker-a", 60_000)).toEqual({
      renewed: false,
      reason: "expired",
    });
    const newer = await claimFor(id, "worker-b");
    expect(await renewLease(fx.member, claim, "worker-a", 60_000)).toEqual({
      renewed: false,
      reason: "fence_superseded",
    });
    expect(await renewLease(fx.member, newer, "worker-b", 60_000)).toEqual({
      renewed: true,
    });
  });

  it("releases only for the holder at that fence and keeps the fence", async () => {
    const { id } = await active("flo");
    const claim = await claimFor(id, "worker-a");
    expect(
      await releaseLease(
        fx.member,
        { ...claim, fence: claim.fence + 1 },
        "worker-a",
      ),
    ).toBe(false);
    expect(await releaseLease(fx.member, claim, "worker-b")).toBe(false);
    expect(await releaseLease(fx.member, claim, "worker-a")).toBe(true);
    const row = await fx.owner.query(
      "SELECT fence, lease_holder_id FROM interview.active_sessions WHERE id=$1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      fence: String(claim.fence),
      lease_holder_id: null,
    });
  });
});

describe("fenced writes (rule:fenced-current-publish)", () => {
  it("refuses the older holder after a newer fence and writes nothing", async () => {
    const { id, scope } = await active("gus");
    const older = await claimFor(id, "worker-a");
    const taskState = tasks("t1", 1);
    const dispatched = await writes.recordAction({
      scope,
      sessionId: id,
      holder: holderOf("worker-a", older),
      tasks: taskState,
      taskId: "t1",
      revision: 1,
      actionKind: "answer",
    });
    expect(dispatched.outcome).toBe("dispatched");
    await expireLease(id);
    const newer = await claimFor(id, "worker-b");
    const before = await actionRows(id);
    // The restarted/older holder is refused for every write.
    const stalePublish = await writes.publishResult({
      scope,
      sessionId: id,
      holder: holderOf("worker-a", older),
      tasks: taskState,
      actionId: (dispatched as { actionId: string }).actionId,
      result: { text: "late" },
    });
    expect(stalePublish).toEqual({
      outcome: "refused",
      reason: "fence_superseded",
      suppressionRecorded: false,
    });
    const staleDispatch = await writes.recordAction({
      scope,
      sessionId: id,
      holder: holderOf("worker-a", older),
      tasks: taskState,
      taskId: "t1",
      revision: 1,
      actionKind: "summary",
    });
    expect(staleDispatch).toEqual({
      outcome: "refused",
      reason: "fence_superseded",
      suppressionRecorded: false,
    });
    expect(
      await writes.recordFailure({
        scope,
        sessionId: id,
        holder: holderOf("worker-a", older),
        actionId: (dispatched as { actionId: string }).actionId,
      }),
    ).toMatchObject({ outcome: "refused" });
    expect(await actionRows(id)).toEqual(before);
    // The successor publishes.
    const published = await writes.publishResult({
      scope,
      sessionId: id,
      holder: holderOf("worker-b", newer),
      tasks: taskState,
      actionId: (dispatched as { actionId: string }).actionId,
      result: { text: "current" },
    });
    expect(published).toEqual({ outcome: "published" });
    expect((await actionRows(id))[0]).toMatchObject({
      dispatch_status: "succeeded",
      result: { text: "current" },
    });
  });

  it("refuses a holder whose lease expired", async () => {
    const { id, scope } = await active("hal");
    const claim = await claimFor(id, "worker-a");
    await expireLease(id);
    expect(
      await writes.recordAction({
        scope,
        sessionId: id,
        holder: holderOf("worker-a", claim),
        tasks: tasks("t1", 1),
        taskId: "t1",
        revision: 1,
        actionKind: "answer",
      }),
    ).toMatchObject({
      outcome: "refused",
      reason: "lease_expired",
      suppressionRecorded: false,
    });
    expect(await actionRows(id)).toHaveLength(0);
  });

  it("refuses a late publish after pause or end, suppressing the action", async () => {
    for (const command of ["pause", "end"] as const) {
      const { id, scope } = await active(`late-${command}`);
      const claim = await claimFor(id, "worker-a");
      const holder = holderOf("worker-a", claim);
      const taskState = tasks("t1", 1);
      const dispatched = await writes.recordAction({
        scope,
        sessionId: id,
        holder,
        tasks: taskState,
        taskId: "t1",
        revision: 1,
        actionKind: "answer",
      });
      await repo.controlSession(scope, id, command);
      const late = await writes.publishResult({
        scope,
        sessionId: id,
        holder,
        tasks: taskState,
        actionId: (dispatched as { actionId: string }).actionId,
        result: { text: "too late" },
      });
      // The pause or end already suppressed the in-flight action in the same
      // transaction, so the late publish finds it settled.
      expect(late).toMatchObject({
        outcome: "refused",
        reason: "action_settled",
        suppressionRecorded: false,
      });
      const row = (await actionRows(id))[0];
      expect(row).toMatchObject({
        dispatch_status: "suppressed",
        result: null,
        shown: false,
      });
      expect(row.suppression_reason).toBe(
        command === "pause" ? "session_paused" : "session_ended",
      );
    }
  });

  it("suppresses dispatch while paused and refuses it once purging, with ids only", async () => {
    const { id, scope } = await active("ivo");
    const claim = await claimFor(id, "worker-a");
    const holder = holderOf("worker-a", claim);
    await repo.controlSession(scope, id, "pause");
    const suppressed = await writes.recordAction({
      scope,
      sessionId: id,
      holder,
      tasks: tasks("t1", 1),
      taskId: "t1",
      revision: 1,
      actionKind: "answer",
    });
    expect(suppressed).toEqual({
      outcome: "suppressed",
      reason: "session_paused",
    });
    const rows = await actionRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dispatch_status: "suppressed",
      suppression_reason: "session_paused",
      result: null,
      job_id: null,
    });
    await repo.deleteSession(scope, id);
    expect(
      await writes.recordAction({
        scope,
        sessionId: id,
        holder,
        tasks: tasks("t1", 1),
        taskId: "t1",
        revision: 1,
        actionKind: "answer",
      }),
    ).toMatchObject({
      outcome: "refused",
      reason: "session_purging",
      suppressionRecorded: false,
    });
    expect(await actionRows(id)).toHaveLength(1);
  });

  it("suppresses a result built on a superseded task revision", async () => {
    const { id, scope } = await active("jan");
    const claim = await claimFor(id, "worker-a");
    const holder = holderOf("worker-a", claim);
    const dispatched = await writes.recordAction({
      scope,
      sessionId: id,
      holder,
      tasks: tasks("t1", 1),
      taskId: "t1",
      revision: 1,
      actionKind: "answer",
    });
    const stale = await writes.publishResult({
      scope,
      sessionId: id,
      holder,
      tasks: tasks("t1", 2),
      actionId: (dispatched as { actionId: string }).actionId,
      result: { text: "old" },
    });
    expect(stale).toMatchObject({
      outcome: "refused",
      reason: "revision_stale",
      suppressionRecorded: true,
    });
    expect((await actionRows(id))[0]).toMatchObject({
      dispatch_status: "suppressed",
      result: null,
    });
    // A newer revision dispatches as its own action.
    expect(
      await writes.recordAction({
        scope,
        sessionId: id,
        holder,
        tasks: tasks("t1", 2),
        taskId: "t1",
        revision: 2,
        actionKind: "answer",
      }),
    ).toMatchObject({ outcome: "dispatched", attempt: 1 });
    // And an unknown task never dispatches.
    expect(
      await writes.recordAction({
        scope,
        sessionId: id,
        holder,
        tasks: tasks("t1", 2),
        taskId: "ghost",
        revision: 1,
        actionKind: "answer",
      }),
    ).toEqual({ outcome: "suppressed", reason: "task_unknown" });
  });

  it("deduplicates dispatch by session, task, revision and action kind; a failed one retries", async () => {
    const { id, scope } = await active("kai");
    const claim = await claimFor(id, "worker-a");
    const holder = holderOf("worker-a", claim);
    const taskState = tasks("t1", 1);
    const dispatch = (kind = "answer") =>
      writes.recordAction({
        scope,
        sessionId: id,
        holder,
        tasks: taskState,
        taskId: "t1",
        revision: 1,
        actionKind: kind,
      });
    const first = await dispatch();
    expect(first).toMatchObject({ outcome: "dispatched", attempt: 1 });
    expect(await dispatch()).toEqual({
      outcome: "duplicate",
      existing: "in-flight",
    });
    // A different action kind is a different dispatch.
    expect((await dispatch("retrieval")).outcome).toBe("dispatched");
    // Fail it: the retry is attempt 2.
    expect(
      await writes.recordFailure({
        scope,
        sessionId: id,
        holder,
        actionId: (first as { actionId: string }).actionId,
      }),
    ).toEqual({ outcome: "recorded" });
    const retry = await dispatch();
    expect(retry).toMatchObject({ outcome: "dispatched", attempt: 2 });
    expect(
      await writes.publishResult({
        scope,
        sessionId: id,
        holder,
        tasks: taskState,
        actionId: (retry as { actionId: string }).actionId,
        result: { text: "ok" },
        show: true,
      }),
    ).toEqual({ outcome: "published" });
    expect(await dispatch()).toEqual({
      outcome: "duplicate",
      existing: "succeeded",
    });
    const session = await repo.getSession(scope, id);
    expect(session?.shownDraftCount).toBe(1);
  });

  it("records a policy suppression with a code only", async () => {
    const { id, scope } = await active("lea");
    const claim = await claimFor(id, "worker-a");
    const holder = holderOf("worker-a", claim);
    const base = {
      scope,
      sessionId: id,
      holder,
      taskId: "t1",
      revision: 1,
      actionKind: "answer",
    };
    expect(
      await writes.recordSuppression({ ...base, reason: "locality-refused" }),
    ).toEqual({ outcome: "recorded" });
    expect((await actionRows(id))[0]).toMatchObject({
      dispatch_status: "suppressed",
      suppression_reason: "locality-refused",
    });
    // Anything that is not a code is refused outright, so no content rides along.
    await expect(
      writes.recordSuppression({
        ...base,
        reason: "what the interviewer said",
      }),
    ).rejects.toBeInstanceOf(SessionError);
  });
});

describe("jobs of a session (rule:action-before-job, rule:job-creation-locked-to-session)", () => {
  it("commits the action naming the job id before the job exists, then creates it private", async () => {
    const { person, id, scope } = await active("mel");
    const claim = await claimFor(id, "worker-a");
    const holder = holderOf("worker-a", claim);
    const jobId = reserveJobId();
    const dispatched = await writes.recordAction({
      scope,
      sessionId: id,
      holder,
      tasks: tasks("t1", 1),
      taskId: "t1",
      revision: 1,
      actionKind: "repair",
      jobId,
    });
    expect(dispatched).toMatchObject({ outcome: "dispatched", jobId });
    expect((await actionRows(id))[0]).toMatchObject({
      job_id: jobId,
      job_created: false,
    });
    expect(
      (await fx.owner.query("SELECT 1 FROM ai.agent_jobs WHERE id=$1", [jobId]))
        .rows,
    ).toHaveLength(0);

    const job = await createSessionJob(fx.member, repo.jobs, {
      scope,
      sessionId: id,
      holder,
      jobId,
      profile: {} as never,
      promptReference: "agent-payload:p1",
    });
    expect(job).toMatchObject({ id: jobId, userId: person.id, private: true });
    expect((await actionRows(id))[0]).toMatchObject({
      job_id: jobId,
      job_created: true,
    });
    // Idempotent on the id.
    const again = await createSessionJob(fx.member, repo.jobs, {
      scope,
      sessionId: id,
      holder,
      jobId,
      profile: {} as never,
      promptReference: "agent-payload:p1",
    });
    expect(again.id).toBe(jobId);
    expect(
      (await fx.owner.query("SELECT 1 FROM ai.agent_jobs WHERE id=$1", [jobId]))
        .rows,
    ).toHaveLength(1);
  });

  it("refuses job creation for a paused session, a stale fence and an unreserved id", async () => {
    const { id, scope } = await active("nat");
    const claim = await claimFor(id, "worker-a");
    const holder = holderOf("worker-a", claim);
    const jobId = reserveJobId();
    await writes.recordAction({
      scope,
      sessionId: id,
      holder,
      tasks: tasks("t1", 1),
      taskId: "t1",
      revision: 1,
      actionKind: "repair",
      jobId,
    });
    const request = {
      scope,
      sessionId: id,
      holder,
      jobId,
      profile: {} as never,
      promptReference: "agent-payload:p",
    };
    // An id no action reserved.
    await expect(
      createSessionJob(fx.member, repo.jobs, {
        ...request,
        jobId: reserveJobId(),
      }),
    ).rejects.toMatchObject({ code: "job_creation_refused" });
    // A stale fence.
    await expect(
      createSessionJob(fx.member, repo.jobs, {
        ...request,
        holder: { ...holder, fence: holder.fence + 1 },
      }),
    ).rejects.toMatchObject({ code: "job_creation_refused" });
    // A paused session.
    await repo.controlSession(scope, id, "pause");
    await expect(
      createSessionJob(fx.member, repo.jobs, request),
    ).rejects.toMatchObject({ code: "job_creation_refused" });
    expect(
      (
        await fx.owner.query(
          "SELECT 1 FROM ai.agent_jobs WHERE tenant_id=$1 AND prompt_reference='agent-payload:p'",
          [tenant],
        )
      ).rows,
    ).toHaveLength(0);
    expect((await actionRows(id))[0]).toMatchObject({ job_created: false });
  });

  it("cancels in-flight jobs on pause and counts an already-terminal job as cancelled", async () => {
    const { person, id, scope } = await active("ora");
    const running = await insertJob(person, "running");
    const done = await insertJob(person, "succeeded");
    for (const [index, jobId] of [running, done].entries())
      await fx.owner.query(
        `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created)
         VALUES($1,$2,$3,'t1',1,$4,1,$5,true)`,
        [tenant, person.id, id, `kind-${index}`, jobId],
      );
    const paused = await repo.controlSession(scope, id, "pause");
    expect(paused.status).toBe("paused");
    const states = await fx.owner.query(
      "SELECT id, status FROM ai.agent_jobs WHERE id = ANY($1::uuid[])",
      [[running, done]],
    );
    const byId = Object.fromEntries(states.rows.map((r) => [r.id, r.status]));
    expect(byId[running]).toBe("cancelling");
    expect(byId[done]).toBe("succeeded");
  });

  it("fails closed when a job the action says exists cannot be seen, after the status flip", async () => {
    const { person, id, scope } = await active("pru");
    const jobId = await insertJob(person, "running");
    await fx.owner.query(
      `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created)
       VALUES($1,$2,$3,'t1',1,'repair',1,$4,true)`,
      [tenant, person.id, id, jobId],
    );
    await fx.owner.query("DELETE FROM ai.agent_jobs WHERE id=$1", [jobId]);
    await expect(repo.controlSession(scope, id, "pause")).rejects.toMatchObject(
      { code: "job_cancellation_failed" },
    );
    // The status flipped first, so the session is paused regardless.
    expect((await repo.getSession(scope, id))?.status).toBe("paused");
  });

  it("resumes a job only while its session is active, found through the action naming it", async () => {
    const { person, id, scope } = await active("quo");
    const jobId = await insertJob(
      person,
      "awaiting-input",
      "runtime-session-1",
    );
    await fx.owner.query(
      `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created)
       VALUES($1,$2,$3,'t1',1,'repair',1,$4,true)`,
      [tenant, person.id, id, jobId],
    );
    expect(
      await resumeSessionJob(repo.jobs, scope, jobId, "agent-payload:next"),
    ).toBe(true);
    await fx.owner.query(
      "UPDATE ai.agent_jobs SET status='awaiting-input' WHERE id=$1",
      [jobId],
    );
    await repo.controlSession(scope, id, "pause");
    await fx.owner.query(
      "UPDATE ai.agent_jobs SET status='awaiting-input' WHERE id=$1",
      [jobId],
    );
    expect(
      await resumeSessionJob(repo.jobs, scope, jobId, "agent-payload:next"),
    ).toBe(false);
    await repo.controlSession(scope, id, "end");
    expect(
      await resumeSessionJob(repo.jobs, scope, jobId, "agent-payload:next"),
    ).toBe(false);
    // A job no action names is refused by the guard.
    const orphan = await insertJob(
      person,
      "awaiting-input",
      "runtime-session-2",
    );
    expect(
      await repo.jobs.requestResume(
        tenant,
        person.id,
        orphan,
        "agent-payload:x",
        {
          guard: sessionJobResumeGuard(tenant, orphan),
        },
      ),
    ).toBe(false);
  });

  it("reads a session job's result only for its owner", async () => {
    const { person, id, scope } = await active("rex");
    const other = await fx.provision(tenant, "sal");
    const jobId = await insertJob(person, "succeeded");
    await fx.owner.query(
      `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created)
       VALUES($1,$2,$3,'t1',1,'repair',1,$4,true)`,
      [tenant, person.id, id, jobId],
    );
    expect((await repo.getSessionJob(scope, id, jobId))?.id).toBe(jobId);
    expect(await repo.getSessionJob(scopeOf(other), id, jobId)).toBeUndefined();
    // Even the actor-carrying get cannot see the private job as another member.
    expect(await repo.jobs.get(tenant, other.id, jobId)).toBeUndefined();
  });
});
