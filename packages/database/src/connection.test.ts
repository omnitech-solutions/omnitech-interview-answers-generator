import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPlatformDatabase,
  type DatabaseClient,
  enterTenant,
  withPoolClient,
} from "./connection.js";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());

it("runs queries, commits transactions and rolls back failed ones", async () => {
  const db = createPlatformDatabase(pg.ownerUrl);
  try {
    await db.query("CREATE TABLE t (n int)");
    await db.transaction(async (c) => c.query("INSERT INTO t VALUES (1)"));
    await expect(
      db.transaction(async (c) => {
        await c.query("INSERT INTO t VALUES (2)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await db.query("SELECT n FROM t")).rows).toEqual([{ n: 1 }]);
    const tenant = await db.tenantTransaction(
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
  } finally {
    await db.close();
  }
});

it("enters a tenant and actor learned inside an open transaction, for that transaction only", async () => {
  const db = createPlatformDatabase(pg.ownerUrl);
  const tenantId = "22222222-2222-2222-2222-222222222222";
  const actorId = "33333333-3333-3333-3333-333333333333";
  const read = async (client: DatabaseClient) =>
    (
      await client.query<{ t: string | null; a: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS t, current_setting('app.actor_id', true) AS a",
      )
    ).rows[0];
  try {
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
  } finally {
    await db.close();
  }
});
