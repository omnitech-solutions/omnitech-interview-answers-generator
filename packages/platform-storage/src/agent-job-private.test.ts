import type { AgentProfile } from "@omnitech/agent-runtime-contracts";
import {
  createPlatformDatabase,
  enterTenant,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAgentJobRepository } from "./agent-job-repository.js";
import { PostgresAgentJobWorkerRepository } from "./agent-job-worker-repository.js";

// ADR-0012 "Agent jobs": a session's job carries an immutable private marker,
// admitted only to its creator and the agent worker. fixture_member is
// NOSUPERUSER NOBYPASSRLS, so forced row-level security binds it.
let pg: DisposablePostgres;
let member: PlatformDatabase;
let repository: PostgresAgentJobRepository;
let worker: PostgresAgentJobWorkerRepository;
let tenantId: string;
let otherTenantId: string;
let alice: string;
let bob: string;

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, ai TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, ai TO fixture_member;`);
  const users = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('alice@example.test', 'Alice'), ('bob@example.test', 'Bob') RETURNING id",
  );
  [alice, bob] = users.rows.map((row) => row.id) as [string, string];
  const tenants = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North'), ('south', 'South') RETURNING id",
  );
  [tenantId, otherTenantId] = tenants.rows.map((row) => row.id) as [
    string,
    string,
  ];
  member = createPlatformDatabase(pg.memberUrl);
  repository = new PostgresAgentJobRepository(member);
  worker = new PostgresAgentJobWorkerRepository(member);
}, 30_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

const profile = {
  id: "fixture",
  version: 1,
  runtime: "codex",
  model: "fixture-model",
  fallbackModels: [],
  effort: "low",
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  sessionPersistence: false,
  maximumTurns: 1,
  timeoutMs: 1_000,
  maximumOutputBytes: 1_000,
  additionalDirectories: [],
  webSearch: false,
} satisfies AgentProfile;

const base = (userId: string) => ({
  tenantId,
  userId,
  productId: "omnitech.interview",
  profile,
  promptReference: "agent-payload:unused",
});

// Raw rows as one actor in the job's tenant, the way a policy sees them.
const asActor = <T>(
  actorId: string | undefined,
  work: (
    query: (text: string, values?: unknown[]) => Promise<unknown[]>,
  ) => Promise<T>,
) =>
  member.transaction(async (client) => {
    await enterTenant(
      client,
      actorId === undefined ? { tenantId } : { tenantId, actorId },
    );
    return work(
      async (text, values) => (await client.query(text, values)).rows,
    );
  });

async function privateJobOf(userId: string) {
  return repository.create({ ...base(userId), private: true });
}

describe("a private job", () => {
  it("is visible and cancellable only to its creator, and fails closed for another member", async () => {
    const job = await privateJobOf(alice);
    expect(job.private).toBe(true);

    expect(await repository.get(tenantId, alice, job.id)).toMatchObject({
      id: job.id,
      private: true,
    });
    expect(await repository.get(tenantId, bob, job.id)).toBeUndefined();
    expect(await repository.get(tenantId, null, job.id)).toBeUndefined();
    expect(await repository.requestCancellation(tenantId, bob, job.id)).toBe(
      "not-found",
    );
    expect(await repository.requestCancellation(tenantId, null, job.id)).toBe(
      "not-found",
    );
    // Bob's attempt changed nothing.
    expect((await repository.get(tenantId, alice, job.id))?.status).toBe(
      "queued",
    );
    expect(await repository.requestCancellation(tenantId, alice, job.id)).toBe(
      "requested",
    );
  });

  it("distinguishes a job the actor cannot see from one that already ended", async () => {
    const job = await privateJobOf(alice);
    await worker.claim("w-ended", 30_000);
    expect(await worker.transition(job.id, ["claimed"], "succeeded")).toBe(
      true,
    );

    expect(await repository.requestCancellation(tenantId, alice, job.id)).toBe(
      "already-ended",
    );
    expect(await repository.requestCancellation(tenantId, bob, job.id)).toBe(
      "not-found",
    );
    expect(
      await repository.requestCancellation(
        tenantId,
        alice,
        crypto.randomUUID(),
      ),
    ).toBe("not-found");
  });

  it("refuses another member's resume and lets the creator resume", async () => {
    const job = await privateJobOf(alice);
    await worker.setSessionId(job.id, "s-1");
    await repository.requestCancellation(tenantId, alice, job.id);
    await worker.transition(job.id, ["cancelling"], "cancelled");

    expect(
      await repository.requestResume(tenantId, bob, job.id, "agent-payload:b"),
    ).toBe(false);
    expect(
      await repository.requestResume(tenantId, null, job.id, "agent-payload:n"),
    ).toBe(false);
    expect(
      await repository.requestResume(
        tenantId,
        alice,
        job.id,
        "agent-payload:a",
      ),
    ).toBe(true);
  });

  it("lets a resume guard run in the transaction and refuse the resume", async () => {
    const job = await privateJobOf(alice);
    await worker.setSessionId(job.id, "s-2");
    await repository.requestCancellation(tenantId, alice, job.id);
    await worker.transition(job.id, ["cancelling"], "cancelled");

    let guarded = 0;
    expect(
      await repository.requestResume(
        tenantId,
        alice,
        job.id,
        "agent-payload:x",
        {
          guard: async (transaction) => {
            guarded += 1;
            // The guard sees the actor-scoped transaction, so it could lock the
            // session row here.
            const visible = await transaction.query(
              "SELECT id FROM ai.agent_jobs WHERE id = $1",
              [job.id],
            );
            expect(visible.rows).toHaveLength(1);
            return false;
          },
        },
      ),
    ).toBe(false);
    expect(guarded).toBe(1);
    expect((await repository.get(tenantId, alice, job.id))?.status).toBe(
      "cancelled",
    );
    expect(
      await repository.requestResume(
        tenantId,
        alice,
        job.id,
        "agent-payload:x",
        {
          guard: async () => true,
        },
      ),
    ).toBe(true);
  });

  it("is still read and advanced by the agent worker, and its events and artifacts reach only the creator", async () => {
    while (await worker.claim("drain", 60_000)) {}
    const job = await privateJobOf(alice);

    const claimed = await worker.claim("worker-private", 30_000);
    expect(claimed).toMatchObject({ id: job.id, private: true });
    expect(await worker.get(tenantId, job.id)).toMatchObject({ id: job.id });
    expect(await worker.transition(job.id, ["claimed"], "running")).toBe(true);
    await worker.appendEvent(job.id, { type: "started", sessionId: "s" });
    await worker.appendEvent(job.id, { type: "text-delta", text: "Hi" });
    await worker.setResultReference(job.id, "agent-payload:result");
    await pg.owner.query(
      "INSERT INTO ai.agent_artifacts (tenant_id, job_id, artifact_reference, kind) VALUES ($1, $2, 'artifact:1', 'file')",
      [tenantId, job.id],
    );

    expect(
      (await repository.eventsAfter(tenantId, alice, job.id, 0)).map(
        (persisted) => persisted.event.type,
      ),
    ).toEqual(["started", "text-delta"]);
    expect(await repository.eventsAfter(tenantId, bob, job.id, 0)).toEqual([]);
    expect(await repository.eventsAfter(tenantId, null, job.id, 0)).toEqual([]);
    const artifacts = (actorId: string | undefined) =>
      asActor(actorId, (query) =>
        query("SELECT id FROM ai.agent_artifacts WHERE job_id = $1", [job.id]),
      );
    expect(await artifacts(alice)).toHaveLength(1);
    expect(await artifacts(bob)).toHaveLength(0);
    expect(await artifacts(undefined)).toHaveLength(0);
    // Bob also cannot delete or rewrite them.
    await asActor(bob, async (query) => {
      await query("DELETE FROM ai.agent_job_events WHERE job_id = $1", [
        job.id,
      ]);
      await query("DELETE FROM ai.agent_jobs WHERE id = $1", [job.id]);
    });
    expect(
      await repository.eventsAfter(tenantId, alice, job.id, 0),
    ).toHaveLength(2);
    expect(await repository.get(tenantId, alice, job.id)).toBeDefined();
  });

  it("is refused to the creator in another tenant", async () => {
    const job = await privateJobOf(alice);
    expect(await repository.get(otherTenantId, alice, job.id)).toBeUndefined();
  });
});

describe("a job that is not private", () => {
  it("behaves as before for every member of its tenant", async () => {
    const job = await repository.create(base(alice));
    expect(job.private).toBe(false);
    expect(await repository.get(tenantId, bob, job.id)).toMatchObject({
      id: job.id,
    });
    expect(await repository.get(tenantId, null, job.id)).toMatchObject({
      id: job.id,
    });
    await worker.appendEvent(job.id, { type: "text-delta", text: "x" });
    expect(
      await repository.eventsAfter(tenantId, null, job.id, 0),
    ).toHaveLength(1);
    expect(await repository.requestCancellation(tenantId, bob, job.id)).toBe(
      "requested",
    );
  });
});

describe("the private marker", () => {
  it("cannot be flipped after insert, by a member or by the worker", async () => {
    const job = await privateJobOf(alice);
    const open = await repository.create(base(alice));
    await expect(
      asActor(alice, (query) =>
        query("UPDATE ai.agent_jobs SET private = false WHERE id = $1", [
          job.id,
        ]),
      ),
    ).rejects.toThrow("immutable");
    await expect(
      asActor(alice, (query) =>
        query("UPDATE ai.agent_jobs SET private = true WHERE id = $1", [
          open.id,
        ]),
      ),
    ).rejects.toThrow("immutable");
    await expect(
      member.transaction(async (client) => {
        await client.query("SELECT set_config('app.agent_worker', 'on', true)");
        await client.query(
          "UPDATE ai.agent_jobs SET private = false WHERE id = $1",
          [job.id],
        );
      }),
    ).rejects.toThrow("immutable");
  });

  it("is set only by the session dispatch path, for the actor creating the job", async () => {
    // A plain insert with the marker set, outside the dispatch path.
    await expect(
      asActor(alice, (query) =>
        query(
          `INSERT INTO ai.agent_jobs (tenant_id, user_id, product_id, status, profile_snapshot, prompt_reference, private)
           VALUES ($1, $2, 'omnitech.interview', 'queued', $3, 'p', true)`,
          [tenantId, alice, profile],
        ),
      ),
    ).rejects.toThrow("session dispatch");
    // Even with the dispatch setting on, the creator must be the actor.
    await expect(
      asActor(bob, async (query) => {
        await query("SELECT set_config('app.session_dispatch', 'on', true)");
        return query(
          `INSERT INTO ai.agent_jobs (tenant_id, user_id, product_id, status, profile_snapshot, prompt_reference, private)
           VALUES ($1, $2, 'omnitech.interview', 'queued', $3, 'p', true)`,
          [tenantId, alice, profile],
        );
      }),
    ).rejects.toThrow("creates it");
    // The repository's private create is that path, as the creating user.
    await expect(
      repository.create({ ...base(bob), private: true }),
    ).resolves.toMatchObject({ userId: bob, private: true });
  });
});

describe("creating a job", () => {
  it("is idempotent on a caller-supplied id", async () => {
    const id = crypto.randomUUID();
    const first = await repository.create({
      ...base(alice),
      id,
      private: true,
    });
    const again = await repository.create({
      ...base(alice),
      id,
      private: true,
    });

    expect(first.id).toBe(id);
    expect(again.id).toBe(id);
    expect(again.createdAt).toEqual(first.createdAt);
    const rows = await pg.owner.query(
      "SELECT 1 FROM ai.agent_jobs WHERE id = $1",
      [id],
    );
    expect(rows.rowCount).toBe(1);
  });

  it("refuses a repeated id that another member or tenant holds", async () => {
    const id = crypto.randomUUID();
    await repository.create({ ...base(alice), id, private: true });
    await expect(
      repository.create({ ...base(bob), id, private: true }),
    ).rejects.toThrow("already in use");
    await expect(
      repository.create({ ...base(alice), tenantId: otherTenantId, id }),
    ).rejects.toThrow("already in use");
  });

  it("runs the beforeInsert hook in the creating transaction and lets it refuse the job", async () => {
    const id = crypto.randomUUID();
    let sawNoRow = false;
    await repository.create(
      { ...base(alice), id, private: true },
      {
        beforeInsert: async (transaction) => {
          const existing = await transaction.query(
            "SELECT id FROM ai.agent_jobs WHERE id = $1",
            [id],
          );
          sawNoRow = existing.rows.length === 0;
        },
      },
    );
    expect(sawNoRow).toBe(true);

    const refused = crypto.randomUUID();
    await expect(
      repository.create(
        { ...base(alice), id: refused, private: true },
        {
          beforeInsert: async () => {
            throw new Error("Session is not active.");
          },
        },
      ),
    ).rejects.toThrow("Session is not active.");
    expect(await repository.get(tenantId, alice, refused)).toBeUndefined();
  });
});
