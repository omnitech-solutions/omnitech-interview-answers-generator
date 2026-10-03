// A tightened (device-only) session can neither create nor resume a remote
// agent job (S5-2): the lock query of createSessionJob and the resume guard
// both read the session's processing policy under the session-row lock, so a
// tighten between the dispatch's last check and the write is still refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskState } from "./core/index.js";
import {
  createSessionJob,
  FencedSessionWrites,
  reserveJobId,
  resumeSessionJob,
} from "./fenced-writes.js";
import {
  type Fixture,
  type Person,
  startFixture,
} from "./live-session-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { claimSessions } from "./session-claim.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
let writes: FencedSessionWrites;
let tenant = "";
beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
  writes = new FencedSessionWrites(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });
const tasks = (taskId: string): TaskState => ({
  tasks: {
    [taskId]: {
      taskId,
      taskKey: `key-${taskId}`,
      revision: 1,
      revisions: [
        {
          revision: 1,
          basedOn: [],
          reason: "opened",
          sourceSuperseded: false,
        },
      ],
    },
  },
  byKey: { [`key-${taskId}`]: taskId },
  deferred: {},
});

async function heldSession(name: string) {
  const person = await fx.provision(tenant, name);
  const scope = scopeOf(person);
  const { session } = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone"],
  });
  const claim = (
    await claimSessions(fx.member, `worker-${name}`, 60_000, 500)
  ).find((c) => c.sessionId === session.id);
  if (!claim) throw new Error("expected a claim");
  return {
    person,
    scope,
    id: session.id,
    holder: { workerId: `worker-${name}`, fence: claim.fence },
  };
}

describe("a tightened session and agent jobs", () => {
  it("refuses to create a job once the session is device-only", async () => {
    const s = await heldSession("job-create");
    const jobId = reserveJobId();
    await writes.recordAction({
      scope: s.scope,
      sessionId: s.id,
      holder: s.holder,
      tasks: tasks("t1"),
      taskId: "t1",
      revision: 1,
      actionKind: "repair",
      jobId,
    });
    await repo.tightenProcessingPolicy(s.scope, s.id, "device-only");
    await expect(
      createSessionJob(fx.member, repo.jobs, {
        scope: s.scope,
        sessionId: s.id,
        holder: s.holder,
        jobId,
        profile: {} as never,
        promptReference: "agent-payload:tightened",
      }),
    ).rejects.toMatchObject({ code: "job_creation_refused" });
    expect(
      (await fx.owner.query("SELECT 1 FROM ai.agent_jobs WHERE id=$1", [jobId]))
        .rows,
    ).toHaveLength(0);
  });

  it("refuses to resume a job once the session is device-only", async () => {
    const s = await heldSession("job-resume");
    const jobId = (
      await fx.pg.owner.transaction(async (client) => {
        await client.query(
          "SELECT set_config('app.session_dispatch','on',true), set_config('app.actor_id',$1,true)",
          [s.person.id],
        );
        return client.query<{ id: string }>(
          `INSERT INTO ai.agent_jobs(tenant_id,user_id,product_id,status,profile_snapshot,prompt_reference,private,session_id)
           VALUES($1,$2,'omnitech.interview','awaiting-input','{}','agent-payload:x',true,'runtime-1') RETURNING id`,
          [tenant, s.person.id],
        );
      })
    ).rows[0]?.id as string;
    await fx.owner.query(
      `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,job_id,job_created)
       VALUES($1,$2,$3,'t1',1,'repair',1,$4,true)`,
      [tenant, s.person.id, s.id, jobId],
    );
    await repo.tightenProcessingPolicy(s.scope, s.id, "device-only");
    expect(
      await resumeSessionJob(repo.jobs, s.scope, jobId, "agent-payload:next"),
    ).toBe(false);
  });
});
