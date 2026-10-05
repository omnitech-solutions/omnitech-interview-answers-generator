import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createPlatformDatabase,
  type PlatformDatabase,
  roleBypassesRowLevelSecurityMessage,
} from "./connection";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres";
import { withTenant } from "./with-tenant";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let pg: DisposablePostgres;
let member: PlatformDatabase;

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await pg.owner.query(`
    CREATE TABLE notes (tenant_id uuid NOT NULL, body text NOT NULL);
    ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notes FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_notes ON notes
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
    GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO fixture_member;`);
  // Sequential transactions reuse the pool's single idle connection, which
  // is exactly the reuse the leak test needs.
  member = createPlatformDatabase(pg.memberUrl);
}, 30_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
});
const opts = () => ({ database: member });

it("scopes reads and writes to the tenant and exposes the actor", async () => {
  await withTenant(
    { tenantId: A, actorId: actor },
    (db) => db.execute(sql`INSERT INTO notes VALUES (${A}, 'a')`),
    opts(),
  );
  await withTenant(
    { tenantId: B, actorId: actor },
    (db) => db.execute(sql`INSERT INTO notes VALUES (${B}, 'b')`),
    opts(),
  );
  const rows = await withTenant(
    { tenantId: A, actorId: actor },
    async (db) =>
      (
        await db.execute(
          sql`SELECT body, current_setting('app.actor_id', true) AS actor FROM notes`,
        )
      ).rows,
    opts(),
  );
  expect(rows).toEqual([{ body: "a", actor }]);
});

it("sets product context only for the scoped transaction", async () => {
  const seen = await withTenant(
    { tenantId: A, actorId: actor, productId: "omnitech.interview" },
    async (db) =>
      (
        await db.execute(
          sql`SELECT current_setting('app.product_id', true) AS product`,
        )
      ).rows[0]?.["product"],
    opts(),
  );
  expect(seen).toBe("omnitech.interview");
  const outside = await member.query(
    "SELECT current_setting('app.product_id', true) AS product",
  );
  expect(outside.rows[0]?.["product"] ?? "").toBe("");
});

it("does not leak context into the next transaction on the same pooled connection", async () => {
  await withTenant(
    { tenantId: A, actorId: actor },
    (db) => db.execute(sql`SELECT 1`),
    opts(),
  );
  const leaked = await member.query(
    "SELECT current_setting('app.tenant_id', true) AS t",
  );
  expect(leaked.rows[0]?.["t"] ?? "").toBe("");
  const seen = await withTenant(
    { tenantId: B, actorId: actor },
    async (db) => (await db.execute(sql`SELECT body FROM notes`)).rows,
    opts(),
  );
  expect(seen).toEqual([{ body: "b" }]);
});

it("fails closed without a tenant context", async () => {
  expect((await member.query("SELECT * FROM notes")).rows).toEqual([]);
  await expect(
    member.query(`INSERT INTO notes VALUES ('${A}', 'x')`),
  ).rejects.toThrow(/row-level security/);
});

it("rolls back the whole unit of work on error", async () => {
  await expect(
    withTenant(
      { tenantId: A, actorId: actor },
      async (db) => {
        await db.execute(sql`INSERT INTO notes VALUES (${A}, 'never')`);
        throw new Error("boom");
      },
      opts(),
    ),
  ).rejects.toThrow("boom");
  const rows = await withTenant(
    { tenantId: A, actorId: actor },
    async (db) =>
      (await db.execute(sql`SELECT body FROM notes WHERE body = 'never'`)).rows,
    opts(),
  );
  expect(rows).toEqual([]);
});

it("exposes typed query-builder selects on the tenant handle", async () => {
  const notesTable = pgTable("notes", {
    tenantId: uuid("tenant_id").notNull(),
    body: text("body").notNull(),
  });

  const schema = { notes: notesTable };

  const rows = await withTenant(
    { tenantId: A, actorId: actor },
    async (db) => {
      const result = await db.select().from(notesTable);
      return result;
    },
    { schema, database: member },
  );

  expect(rows).toEqual([{ tenantId: A, body: "a" }]);
});

it("nests db.transaction() as a savepoint that keeps the tenant", async () => {
  const seen = await withTenant(
    { tenantId: A, actorId: actor },
    async (db) => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO notes VALUES (${A}, 'nested')`);
      });
      const setting = await db.execute(
        sql`SELECT current_setting('app.tenant_id', true) AS t`,
      );
      const visible = await db.execute(
        sql`SELECT body FROM notes WHERE body = 'nested'`,
      );
      return { tenant: setting.rows[0]?.["t"], rows: visible.rows };
    },
    opts(),
  );
  expect(seen).toEqual({ tenant: A, rows: [{ body: "nested" }] });
});

it("rolls back only the failed nested savepoint", async () => {
  await withTenant(
    { tenantId: A, actorId: actor },
    async (db) => {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`INSERT INTO notes VALUES (${A}, 'inner')`);
          throw new Error("inner boom");
        }),
      ).rejects.toThrow("inner boom");
      await db.execute(sql`INSERT INTO notes VALUES (${A}, 'outer')`);
    },
    opts(),
  );
  const rows = await withTenant(
    { tenantId: A, actorId: actor },
    async (db) =>
      (
        await db.execute(
          sql`SELECT body FROM notes WHERE body IN ('inner', 'outer')`,
        )
      ).rows,
    opts(),
  );
  expect(rows).toEqual([{ body: "outer" }]);
});

it("refuses a role that bypasses row-level security", async () => {
  // refusal is the point of this test: no opt-in on a superuser URL
  const owner = createPlatformDatabase(pg.ownerUrl);
  try {
    await expect(
      withTenant(
        { tenantId: A, actorId: actor },
        (db) => db.execute(sql`SELECT 1`),
        { database: owner },
      ),
    ).rejects.toThrow(roleBypassesRowLevelSecurityMessage);
  } finally {
    await owner.close();
  }
  await expect(
    withTenant(
      { tenantId: A, actorId: actor },
      async (db) => (await db.execute(sql`SELECT 1 AS ok`)).rows,
      opts(),
    ),
  ).resolves.toEqual([{ ok: 1 }]);
});
