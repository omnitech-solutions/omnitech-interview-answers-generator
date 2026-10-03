import {
  createPlatformDatabase,
  type PlatformDatabase,
  type TenantDatabase,
  withTenant,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema.js";

let pg: DisposablePostgres;
let member: PlatformDatabase;
const extraPools: PlatformDatabase[] = [];
const ids = { tenantA: "", tenantB: "", alice: "", bob: "", carol: "" };

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, interview, practice TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA interview, practice TO fixture_member;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO fixture_member;`);
  // Platform rows: tenants A and B; alice and carol in A, bob in B.
  const one = async (q: string) =>
    String((await pg.owner.query(q)).rows[0]?.["id"]);
  ids.tenantA = await one(
    "INSERT INTO platform.tenants (slug, name) VALUES ('a', 'A') RETURNING id",
  );
  ids.tenantB = await one(
    "INSERT INTO platform.tenants (slug, name) VALUES ('b', 'B') RETURNING id",
  );
  ids.alice = await one(
    "INSERT INTO platform.users (email, display_name) VALUES ('alice@x', 'Alice') RETURNING id",
  );
  ids.bob = await one(
    "INSERT INTO platform.users (email, display_name) VALUES ('bob@x', 'Bob') RETURNING id",
  );
  ids.carol = await one(
    "INSERT INTO platform.users (email, display_name) VALUES ('carol@x', 'Carol') RETURNING id",
  );
  await pg.owner.query(
    `INSERT INTO platform.tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`,
    [ids.tenantA, ids.alice, ids.carol, ids.tenantB, ids.bob],
  );
  member = createPlatformDatabase(pg.memberUrl);
}, 60_000);
afterAll(async () => {
  await member?.close();
  for (const extra of extraPools) await extra.close();
  await pg?.stop();
});

const as = <T>(
  tenantId: string,
  actorId: string,
  work: (db: TenantDatabase) => Promise<T>,
) => withTenant({ tenantId, actorId }, work, { database: member });

// Drizzle wraps database errors; the Postgres message may be on `cause`.
async function expectFailure(work: Promise<unknown>, pattern: RegExp) {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  const text = `${(error as Error).message} ${(error as { cause?: Error }).cause?.message ?? ""}`;
  expect(text).toMatch(pattern);
}

async function seedCompany(tenantId: string, actorId: string, name: string) {
  return as(
    tenantId,
    actorId,
    async (db) =>
      (
        await db
          .insert(schema.companies)
          .values({ tenantId, name, createdBy: actorId })
          .returning()
      )[0]!,
  );
}

describe("tenant isolation", () => {
  it("1: a tenant sees only its own rows", async () => {
    await seedCompany(ids.tenantA, ids.alice, "Acme");
    await seedCompany(ids.tenantB, ids.bob, "Beta");
    const names = await as(ids.tenantA, ids.alice, async (db) =>
      (await db.select().from(schema.companies)).map((c) => c.name),
    );
    expect(names).toEqual(["Acme"]);
  });

  it("2: a tenant cannot insert rows for another tenant", async () => {
    await expectFailure(
      as(ids.tenantA, ids.alice, (db) =>
        db
          .insert(schema.companies)
          .values({ tenantId: ids.tenantB, name: "Sneaky" }),
      ),
      /row-level security/,
    );
  });

  it("3: a tenant cannot update or delete another tenant's rows", async () => {
    const beta = await seedCompany(ids.tenantB, ids.bob, "Beta2");
    const updated = await as(ids.tenantA, ids.alice, (db) =>
      db
        .update(schema.companies)
        .set({ name: "Owned" })
        .where(eq(schema.companies.id, beta.id))
        .returning(),
    );
    const deleted = await as(ids.tenantA, ids.alice, (db) =>
      db
        .delete(schema.companies)
        .where(eq(schema.companies.id, beta.id))
        .returning(),
    );
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
    const unchanged = await as(ids.tenantB, ids.bob, (db) =>
      db
        .select()
        .from(schema.companies)
        .where(eq(schema.companies.id, beta.id)),
    );
    expect(unchanged.map((c) => c.name)).toEqual(["Beta2"]);
  });

  it("4: a row cannot reference a parent in another tenant (composite FK)", async () => {
    const beta = await seedCompany(ids.tenantB, ids.bob, "Beta3");
    await expectFailure(
      as(ids.tenantA, ids.alice, (db) =>
        db
          .insert(schema.people)
          .values({ tenantId: ids.tenantA, fullName: "X", companyId: beta.id }),
      ),
      /foreign key/,
    );
  });

  it("5: with no tenant context nothing is visible and writes fail", async () => {
    expect(
      (await member.query("SELECT * FROM interview.companies")).rows,
    ).toEqual([]);
    await expect(
      member.query(
        `INSERT INTO interview.companies (tenant_id, name) VALUES ('${ids.tenantA}', 'Nope')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("6: a pooled connection does not keep the previous tenant", async () => {
    // A pool holding exactly one idle client forces both tenants through the
    // same physical connection, so a leak could not hide behind pool size.
    const single = createPlatformDatabase(pg.memberUrl);
    extraPools.push(single);
    await single.query("SELECT 1");
    await seedCompany(ids.tenantA, ids.alice, "Acme6");
    await seedCompany(ids.tenantB, ids.bob, "Beta6");
    const asOn = <T>(
      tenantId: string,
      actorId: string,
      work: (db: TenantDatabase) => Promise<T>,
    ) => withTenant({ tenantId, actorId }, work, { database: single });
    const namesA = await asOn(ids.tenantA, ids.alice, async (db) =>
      (await db.select().from(schema.companies)).map((c) => c.name),
    );
    expect(namesA).toContain("Acme6");
    const leftover = await single.query(
      "SELECT nullif(current_setting('app.tenant_id', true), '') AS t",
    );
    expect(leftover.rows[0]?.["t"]).toBeNull();
    const namesB = await asOn(ids.tenantB, ids.bob, async (db) =>
      (await db.select().from(schema.companies)).map((c) => c.name),
    );
    expect(namesB).toContain("Beta6");
    expect(namesB).not.toContain("Acme6");
  });

  it("7: forced row-level security binds the table owner", async () => {
    // The fixture owner is the cluster's bootstrap superuser, which bypasses
    // RLS unconditionally. FORCE only matters for a non-superuser owner, so
    // hand the table to one for the duration of the check.
    await pg.owner.query(
      `INSERT INTO interview.companies (tenant_id, name) VALUES ($1, 'Owned7')`,
      [ids.tenantA],
    );
    const before = await pg.owner.query(
      "SELECT count(*)::int AS n FROM interview.companies",
    );
    expect(before.rows[0]?.["n"]).toBeGreaterThan(0);
    const results = (await pg.owner.query(`
      CREATE ROLE rls_table_owner NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA interview TO rls_table_owner;
      ALTER TABLE interview.companies OWNER TO rls_table_owner;
      BEGIN;
      SET LOCAL ROLE rls_table_owner;
      SELECT count(*)::int AS n FROM interview.companies;
      COMMIT;
      ALTER TABLE interview.companies OWNER TO fixture_owner;
      DROP OWNED BY rls_table_owner;
      DROP ROLE rls_table_owner;`)) as unknown as Array<{
      rows: Array<{ n?: number }>;
    }>;
    const count = results.find((r) => r.rows[0]?.n !== undefined)?.rows[0]?.n;
    expect(count).toBe(0);
    const forced = await pg.owner.query(
      "SELECT relforcerowsecurity FROM pg_class WHERE oid = 'interview.companies'::regclass",
    );
    expect(forced.rows[0]?.["relforcerowsecurity"]).toBe(true);
  });
});

describe("practice", () => {
  it("8: shared exercises are readable but not writable by a tenant", async () => {
    // Shared rows are seeded by the owner. NO FORCE/FORCE documents the path
    // for a non-superuser seeder; the superuser fixture owner bypasses RLS.
    await pg.owner.query(`
      ALTER TABLE practice.exercises NO FORCE ROW LEVEL SECURITY;
      INSERT INTO practice.exercises (slug, title, prompt, prompt_key, kind, source_kind) VALUES ('two-sum', 'Two Sum', 'p', 'p', 'algorithm', 'original');
      ALTER TABLE practice.exercises FORCE ROW LEVEL SECURITY;`);
    const seen = await as(ids.tenantA, ids.alice, async (db) =>
      (await db.select().from(schema.exercises)).map((e) => e.slug),
    );
    expect(seen).toContain("two-sum");
    await expectFailure(
      as(ids.tenantA, ids.alice, (db) =>
        db.insert(schema.exercises).values({
          slug: "x",
          title: "x",
          prompt: "x",
          promptKey: "x",
          kind: "algorithm",
          sourceKind: "original",
        }),
      ),
      /row-level security/,
    );
    const changed = await as(ids.tenantA, ids.alice, (db) =>
      db
        .update(schema.exercises)
        .set({ title: "Mine" })
        .where(eq(schema.exercises.slug, "two-sum"))
        .returning(),
    );
    expect(changed).toEqual([]);
  });

  it("9: an attempt is private to its user within the workspace", async () => {
    const exercise = await as(
      ids.tenantA,
      ids.alice,
      async (db) =>
        (
          await db
            .insert(schema.exercises)
            .values({
              tenantId: ids.tenantA,
              slug: "private-q",
              title: "Q",
              prompt: "q",
              promptKey: "q",
              kind: "algorithm",
              sourceKind: "user_submitted",
            })
            .returning()
        )[0]!,
    );
    await as(ids.tenantA, ids.alice, (db) =>
      db.insert(schema.exerciseAttempts).values({
        tenantId: ids.tenantA,
        userId: ids.alice,
        exerciseId: exercise.id,
        language: "typescript",
        draftId: "q-1",
      }),
    );
    const forCarol = await as(ids.tenantA, ids.carol, (db) =>
      db.select().from(schema.exerciseAttempts),
    );
    expect(forCarol).toEqual([]);
    const forAlice = await as(ids.tenantA, ids.alice, (db) =>
      db.select().from(schema.exerciseAttempts),
    );
    expect(forAlice).toHaveLength(1);
  });
});

it("11: every reference between tenant-owned tables uses the composite tenant key", () => {
  const tenantOwned = new Set<string>(
    schema.domainTables.map((t) => getTableName(t)),
  );
  let checked = 0;
  for (const table of schema.domainTables) {
    expect(getTableConfig(table).enableRLS, getTableName(table)).toBe(true);
    for (const fk of getTableConfig(table).foreignKeys) {
      const ref = fk.reference();
      const target = getTableName(ref.foreignTable);
      if (!tenantOwned.has(target)) continue;
      checked += 1;
      expect(ref.columns, getTableName(table)).toHaveLength(2);
      expect([
        getTableName(table),
        ref.columns[0]?.name,
        ref.foreignColumns[0]?.name,
      ]).toEqual([getTableName(table), "tenant_id", "tenant_id"]);
    }
  }
  expect(checked).toBeGreaterThan(0);
});

it("12: the live catalog forces RLS on every declared table and every tenant policy checks what it filters", async () => {
  // Runs last: cases 7 and 8 temporarily change ownership and FORCE.
  const exported: unknown[] = Object.values(schema);
  const declared = exported
    .filter((value: unknown): value is PgTable => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return `${config.schema}.${config.name}`;
    });
  expect(declared).toContain("practice.exercises");
  expect(declared).toHaveLength(schema.domainTables.length + 1);
  const flags = await pg.owner.query<{
    name: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT n.nspname || '.' || c.relname AS name, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname || '.' || c.relname = ANY($1)`,
    [declared],
  );
  expect(flags.rows.map((r) => r.name).sort()).toEqual([...declared].sort());
  for (const row of flags.rows)
    expect(
      [row.name, row.relrowsecurity, row.relforcerowsecurity],
      row.name,
    ).toEqual([row.name, true, true]);
  const policies = await pg.owner.query<{
    name: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `SELECT schemaname || '.' || tablename || '.' || policyname AS name, qual, with_check
       FROM pg_policies
      WHERE schemaname IN ('interview', 'practice') AND cmd = 'ALL'`,
  );
  expect(policies.rows.length).toBeGreaterThan(0);
  for (const policy of policies.rows)
    expect(policy.with_check, policy.name).toBe(policy.qual);
});
