import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlatformDatabase, type PlatformDatabase } from "./connection.js";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";
import { withTenant } from "./with-tenant.js";

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

it("supports typed relational queries with schema", async () => {
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
