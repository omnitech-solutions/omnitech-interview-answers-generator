import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPlatformDatabase,
  type DatabaseClient,
  enterTenant,
  type PlatformDatabase,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
  withPoolClient,
} from "./connection.js";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";
import { withTenant } from "./with-tenant.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());

// Tenant-scoped paths refuse a superuser, so they run as the member role.
let member: PlatformDatabase;
beforeAll(() => {
  member = createPlatformDatabase(pg.memberUrl);
});
afterAll(async () => member?.close());

it("runs queries, commits transactions and rolls back failed ones", async () => {
  // The owner handle opted in to bypass; it only creates the scratch table.
  const db = pg.owner;
  await db.query("CREATE TABLE t (n int)");
  await db.transaction(async (c) => c.query("INSERT INTO t VALUES (1)"));
  await expect(
    db.transaction(async (c) => {
      await c.query("INSERT INTO t VALUES (2)");
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect((await db.query("SELECT n FROM t")).rows).toEqual([{ n: 1 }]);
  const tenant = await member.tenantTransaction(
    "11111111-1111-1111-1111-111111111111",
    (c) => c.query("SELECT current_setting('app.tenant_id', true) AS t"),
  );
  expect(tenant.rows[0]).toEqual({
    t: "11111111-1111-1111-1111-111111111111",
  });
  expect(
    await withPoolClient(
      db,
      async (client) => (await client.query("SELECT 1 AS one")).rows,
    ),
  ).toEqual([{ one: 1 }]);
});

it("enters a tenant and actor learned inside an open transaction, for that transaction only", async () => {
  const db = member;
  const tenantId = "22222222-2222-2222-2222-222222222222";
  const actorId = "33333333-3333-3333-3333-333333333333";
  const read = async (client: DatabaseClient) =>
    (
      await client.query<{ t: string | null; a: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS t, current_setting('app.actor_id', true) AS a",
      )
    ).rows[0];
  {
    const inside = await db.transaction(async (client) => {
      await enterTenant(client, { tenantId, actorId });
      return read(client);
    });
    expect(inside).toEqual({ t: tenantId, a: actorId });
    const tenantOnly = await db.transaction(async (client) => {
      await enterTenant(client, { tenantId });
      return read(client);
    });
    expect(tenantOnly?.t).toBe(tenantId);
    expect(tenantOnly?.a ?? "").toBe("");
    const after = await read(db);
    expect(after?.t ?? "").toBe("");
    expect(after?.a ?? "").toBe("");
  }
});

// A handle refuses to serve anything when its role bypasses row-level
// security, unless it was created with the explicit opt-in: fixture_owner is
// the bootstrap superuser, fixture_member the application role, and
// fixture_bypass a non-super role with BYPASSRLS.
it("refuses a superuser or BYPASSRLS handle on every entry, and admits the application role", async () => {
  const tenantId = "44444444-4444-4444-4444-444444444444";
  const actorId = "55555555-5555-5555-5555-555555555555";
  await pg.owner.query("CREATE ROLE fixture_bypass LOGIN BYPASSRLS");
  const refusedHandles = [
    // refusal is the point of this test: no opt-in on a superuser URL
    createPlatformDatabase(pg.ownerUrl),
    createPlatformDatabase(
      pg.memberUrl.replace("fixture_member", "fixture_bypass"),
    ),
  ];
  try {
    for (const refused of refusedHandles) {
      const entries = [
        () => refused.query("SELECT 1"),
        () => refused.transaction(async () => undefined),
        () => refused.tenantTransaction(tenantId, async () => undefined),
        () =>
          withTenant({ tenantId, actorId }, async () => undefined, {
            database: refused,
          }),
        () => verifyDatabaseRole(refused),
      ];
      for (const enter of entries)
        await expect(enter()).rejects.toThrow(
          roleBypassesRowLevelSecurityMessage,
        );
    }
    await expect(member.query("SELECT 1")).resolves.toBeDefined();
    await expect(member.transaction(async () => "ok")).resolves.toBe("ok");
    await expect(
      member.tenantTransaction(tenantId, async () => "ok"),
    ).resolves.toBe("ok");
    await expect(
      member.transaction((client) => enterTenant(client, { tenantId })),
    ).resolves.toBeUndefined();
    await expect(
      withTenant({ tenantId, actorId }, async () => "ok", { database: member }),
    ).resolves.toBe("ok");
    await expect(verifyDatabaseRole(member)).resolves.toBeUndefined();
  } finally {
    await Promise.all(refusedHandles.map((handle) => handle.close()));
  }
});

it("lets an explicitly opted-in owner handle serve, yet still refuses enterTenant on its clients", async () => {
  const tenantId = "66666666-6666-4666-8666-666666666666";
  await expect(pg.owner.query("SELECT 1 AS one")).resolves.toBeDefined();
  await expect(verifyDatabaseRole(pg.owner)).resolves.toBeUndefined();
  await expect(
    pg.owner.transaction((client) => enterTenant(client, { tenantId })),
  ).rejects.toThrow(roleBypassesRowLevelSecurityMessage);
});
