import type { AgentProfile } from "@omnitech/agent-runtime-contracts";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "./agent-job-repository.js";

// fixture_member is NOSUPERUSER NOBYPASSRLS, so every tenant policy binds it
// exactly as forced row-level security binds the app role that owns the tables.
let pg: DisposablePostgres;
let member: PlatformDatabase;
let tenantId: string;
let otherTenantId: string;
let userId: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, ai TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, ai TO fixture_member;`);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('ada@example.test', 'Ada') RETURNING id",
  );
  userId = user.rows[0]!.id;
  const tenants = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('north', 'North'), ('south', 'South') RETURNING id",
  );
  [tenantId, otherTenantId] = tenants.rows.map((row) => row.id) as [
    string,
    string,
  ];
  member = createPlatformDatabase(pg.memberUrl);
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

it("lets the worker claim and run a tenant's job before it knows the tenant", async () => {
  const repository = new PostgresAgentJobRepository(member);
  const payloads = new AgentPayloadStore(member, "x".repeat(32));
  const promptReference = await payloads.save(tenantId, "Summarise the plan");
  const created = await repository.create({
    tenantId,
    userId,
    productId: "omnitech.interview",
    profile,
    promptReference,
  });

  // The worker polls across tenants: it holds only a job's id from here on.
  const claimed = await repository.claim("worker-1", 30_000);
  expect(claimed?.id).toBe(created.id);
  expect(await payloads.load(claimed!.promptReference)).toBe(
    "Summarise the plan",
  );
  expect(await repository.transition(created.id, ["claimed"], "starting")).toBe(
    true,
  );
  await repository.setSessionId(created.id, "session-1");
  const appended = await repository.appendEvent(created.id, {
    type: "started",
    sessionId: "session-1",
  });
  expect(appended.sequence).toBe(1);
  const resultReference = await payloads.save(tenantId, '"done"');
  await repository.setResultReference(created.id, resultReference);

  const stored = await repository.get(tenantId, created.id);
  expect(stored).toMatchObject({
    status: "starting",
    sessionId: "session-1",
    resultReference,
  });
  // The tenant boundary still holds for everything that is not the worker.
  expect(await repository.get(otherTenantId, created.id)).toBeUndefined();
});

it("finds the tenant of a job addressed only by its id, so it can be cancelled", async () => {
  const repository = new PostgresAgentJobRepository(member);
  const created = await repository.create({
    tenantId: otherTenantId,
    userId,
    productId: "omnitech.interview",
    profile,
    promptReference: "agent-payload:unused",
  });

  expect(await repository.tenantOf(created.id)).toBe(otherTenantId);
  expect(await repository.tenantOf(crypto.randomUUID())).toBeUndefined();
});

it("reads a payload only by its reference and removes it within its tenant", async () => {
  const payloads = new AgentPayloadStore(member, "x".repeat(32));
  const reference = await payloads.save(tenantId, "secret prompt");

  await payloads.remove(otherTenantId, reference);
  expect(await payloads.load(reference)).toBe("secret prompt");
  await payloads.remove(tenantId, reference);
  await expect(payloads.load(reference)).rejects.toThrow(
    "Agent job payload is unavailable.",
  );
});

it("lets another worker reclaim a running job whose lease has expired", async () => {
  const repository = new PostgresAgentJobRepository(member);
  // Drain any job an earlier test left queued.
  while (await repository.claim("drain", 60_000)) {}
  const created = await repository.create({
    tenantId,
    userId,
    productId: "omnitech.interview",
    profile,
    promptReference: "agent-payload:lease",
  });

  const first = await repository.claim("worker-1", 1);
  await repository.transition(created.id, ["claimed"], "running");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const reclaimed = await repository.claim("worker-2", 30_000);

  expect(first).toMatchObject({ id: created.id, claimedBy: "worker-1" });
  expect(reclaimed).toMatchObject({
    id: created.id,
    status: "claimed",
    claimedBy: "worker-2",
  });
  expect(reclaimed?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  // A live lease is not handed to a third worker.
  expect(await repository.claim("worker-3", 30_000)).toBeUndefined();
});

it("replays a job's events after a sequence, in order", async () => {
  const repository = new PostgresAgentJobRepository(member);
  const created = await repository.create({
    tenantId,
    userId,
    productId: "omnitech.interview",
    profile,
    promptReference: "agent-payload:events",
  });
  await repository.appendEvent(created.id, { type: "started", sessionId: "s" });
  await repository.appendEvent(created.id, { type: "text-delta", text: "Hi" });
  await repository.appendEvent(created.id, {
    type: "completed",
    result: { sessionId: "s", output: "Hi" },
  });

  const events = await repository.eventsAfter(created.id, 1);

  expect(events.map((event) => [event.sequence, event.event.type])).toEqual([
    [2, "text-delta"],
    [3, "completed"],
  ]);
  expect(events[0]?.createdAt).toBeInstanceOf(Date);
  await expect(
    repository.appendEvent(crypto.randomUUID(), {
      type: "text-delta",
      text: "",
    }),
  ).rejects.toThrow("Agent job was not found.");
});

it("cancels and resumes a job only within its tenant and from a resumable state", async () => {
  const repository = new PostgresAgentJobRepository(member);
  const created = await repository.create({
    tenantId,
    userId,
    productId: "omnitech.interview",
    profile,
    promptReference: "agent-payload:first",
  });

  expect(await repository.requestCancellation(otherTenantId, created.id)).toBe(
    false,
  );
  expect(await repository.requestCancellation(tenantId, created.id)).toBe(true);
  expect(
    await repository.transition(created.id, ["cancelling"], "cancelled"),
  ).toBe(true);
  // A cancelled job without a session has nothing to resume.
  expect(
    await repository.requestResume(tenantId, created.id, "agent-payload:next"),
  ).toBe(false);
  await repository.setSessionId(created.id, "session-9");
  expect(
    await repository.requestResume(
      otherTenantId,
      created.id,
      "agent-payload:x",
    ),
  ).toBe(false);
  expect(
    await repository.requestResume(tenantId, created.id, "agent-payload:next"),
  ).toBe(true);

  expect(await repository.get(tenantId, created.id)).toMatchObject({
    status: "queued",
    promptReference: "agent-payload:next",
    sessionId: "session-9",
  });
  // A transition from a state the job is not in changes nothing.
  expect(await repository.transition(created.id, ["running"], "failed")).toBe(
    false,
  );
});
