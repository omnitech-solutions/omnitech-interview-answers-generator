import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlatformDatabase, withPoolClient } from "./connection.js";
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
