import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformDatabase, verifyDatabaseRole } from "./connection";
import { migrateDatabase } from "./migrate";
import { verifyMigrations } from "./migration-check";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres";

// The owner/runtime role split (ADR-0005 d4): `omnitech_owner` owns the schemas
// and migrates; `omnitech` has USAGE and DML only, so a compromised app cannot
// disable its own row-level security. docker/postgres/ensure-roles.sql is the
// one idempotent step that creates both (fresh volume) or upgrades a database
// the runtime role used to own (existing volume).
const ensureRolesSql = await readFile(
  fileURLToPath(
    new URL("../../../docker/postgres/ensure-roles.sql", import.meta.url),
  ),
  "utf8",
);

let pg: DisposablePostgres;
const url = (role: string, database: string) =>
  pg.ownerUrl
    .replace("fixture_owner", role)
    .replace(/\/postgres$/, `/${database}`);
const administrator = (database: string) =>
  createPlatformDatabase(url("fixture_owner", database), {
    allowRlsBypass: true,
  });

beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 60_000);
afterAll(async () => pg?.stop());

// Ownership, privileges and default privileges of everything the step touches.
const accessSnapshot = `
  SELECT 'database' AS kind, datname::text AS name, pg_get_userbyid(datdba)::text AS owner, datacl::text AS acl
    FROM pg_database WHERE datname = current_database()
  UNION ALL SELECT 'schema', nspname::text, pg_get_userbyid(nspowner)::text, nspacl::text
    FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
  UNION ALL SELECT 'relation', n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner)::text, c.relacl::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'S', 'v') AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
  UNION ALL SELECT 'default', defaclrole::regrole::text || defaclobjtype::text, '', defaclacl::text
    FROM pg_default_acl
  UNION ALL SELECT 'role', rolname::text, '', (rolsuper::text || rolbypassrls::text || rolcreaterole::text || rolcreatedb::text)
    FROM pg_roles WHERE rolname IN ('omnitech', 'omnitech_owner')
  ORDER BY 1, 2`;

async function snapshot(database: string): Promise<unknown[]> {
  const admin = administrator(database);
  try {
    return (await admin.query(accessSnapshot)).rows;
  } finally {
    await admin.close();
  }
}

async function ensureRoles(database: string): Promise<void> {
  const admin = administrator(database);
  try {
    await admin.query(ensureRolesSql);
  } finally {
    await admin.close();
  }
}

// What the runtime role must not be able to do, each refused by PostgreSQL for
// want of ownership or privilege (42501), never by a missing object.
const refusedToRuntime: [string, string][] = [
  [
    "disable row-level security",
    "ALTER TABLE platform.tenant_memberships DISABLE ROW LEVEL SECURITY",
  ],
  [
    "drop FORCE",
    "ALTER TABLE platform.tenant_memberships NO FORCE ROW LEVEL SECURITY",
  ],
  ["drop a policy", 'DROP POLICY "agent_worker_read" ON ai.agent_jobs'],
  ["disable triggers", "ALTER TABLE ai.agent_jobs DISABLE TRIGGER ALL"],
  ["create a table in an owner schema", "CREATE TABLE platform.rogue (id int)"],
  [
    "create a function in an owner schema",
    "CREATE FUNCTION platform.rogue() RETURNS int LANGUAGE sql AS 'SELECT 1'",
  ],
  ["drop a table", "DROP TABLE platform.tenant_memberships"],
  ["truncate a table", "TRUNCATE platform.users CASCADE"],
  ["rewrite the migration history", "DELETE FROM drizzle.__drizzle_migrations"],
  ["become the owner", "SET ROLE omnitech_owner"],
];

describe.each([
  { name: "a fresh database", legacy: false },
  { name: "an existing database the runtime role owned", legacy: true },
])("the role split on $name", ({ legacy }) => {
  const database = legacy ? "legacy" : "fresh";
  let runtime: ReturnType<typeof createPlatformDatabase>;
  let owner: ReturnType<typeof createPlatformDatabase>;
  let existingUser: string | undefined;

  beforeAll(async () => {
    const admin = administrator("postgres");
    try {
      if (legacy) {
        // The layout before the split: one role owns the database and migrates.
        await admin.query(
          "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnitech') THEN CREATE ROLE omnitech LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$",
        );
        await admin.query(`CREATE DATABASE ${database} OWNER omnitech`);
      } else {
        await admin.query(`CREATE DATABASE ${database}`);
      }
    } finally {
      await admin.close();
    }
    if (legacy) {
      const old = createPlatformDatabase(url("omnitech", database));
      try {
        await migrateDatabase(old);
        existingUser = (
          await old.query<{ id: string }>(
            "INSERT INTO platform.users (email, display_name) VALUES ('kept@example.test', 'Kept') RETURNING id",
          )
        ).rows[0]?.id;
      } finally {
        await old.close();
      }
    }
    await ensureRoles(database);
    owner = createPlatformDatabase(url("omnitech_owner", database));
    // Migrations apply as the owner (a no-op when the legacy run did it).
    await migrateDatabase(owner);
    await ensureRoles(database);
    runtime = createPlatformDatabase(url("omnitech", database));
  }, 120_000);
  afterAll(async () => {
    await runtime?.close();
    await owner?.close();
  });

  it("passes the role guard and the boot-time migration check as the runtime role", async () => {
    await expect(verifyDatabaseRole(runtime)).resolves.toBeUndefined();
    await expect(verifyMigrations(runtime)).resolves.toBeUndefined();
  });

  it("gives the owner the database, every schema and every table, and the runtime none", async () => {
    const admin = administrator(database);
    try {
      const owners = await admin.query<{ owner: string; kind: string }>(
        `SELECT 'database' AS kind, pg_get_userbyid(datdba)::text AS owner FROM pg_database WHERE datname = current_database()
         UNION ALL SELECT 'schema', pg_get_userbyid(nspowner)::text FROM pg_namespace
           WHERE nspname IN ('platform', 'ai', 'interview', 'practice', 'presentation', 'assistant', 'drizzle')
         UNION ALL SELECT 'table', pg_get_userbyid(c.relowner)::text FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('platform', 'ai', 'interview', 'practice', 'presentation', 'assistant', 'drizzle')`,
      );
      expect(owners.rows.length).toBeGreaterThan(40);
      expect(new Set(owners.rows.map((row) => row.owner))).toEqual(
        new Set(["omnitech_owner"]),
      );
    } finally {
      await admin.close();
    }
  });

  it("serves the app's normal reads and writes", async () => {
    const written = await runtime.query<{ id: string }>(
      "INSERT INTO platform.users (email, display_name) VALUES ($1, 'Runtime') RETURNING id",
      [`runtime-${database}@example.test`],
    );
    expect(written.rows).toHaveLength(1);
    await runtime.query(
      "UPDATE platform.users SET display_name = 'Renamed' WHERE id = $1",
      [written.rows[0]?.id],
    );
    const read = await runtime.query<{ display_name: string }>(
      "SELECT display_name FROM platform.users WHERE id = $1",
      [written.rows[0]?.id],
    );
    expect(read.rows[0]?.display_name).toBe("Renamed");
    await runtime.query("DELETE FROM platform.users WHERE id = $1", [
      written.rows[0]?.id,
    ]);
  });

  it.each(refusedToRuntime)(
    "refuses the runtime role to %s",
    async (_what, statement) => {
      await expect(runtime.query(statement)).rejects.toMatchObject({
        code: "42501",
      });
    },
  );

  it("uses a table a later migration adds without another grant", async () => {
    await owner.query("CREATE TABLE platform.added_later (id int PRIMARY KEY)");
    try {
      await runtime.query("INSERT INTO platform.added_later VALUES (1)");
      expect(
        (await runtime.query("SELECT id FROM platform.added_later")).rows,
      ).toEqual([{ id: 1 }]);
    } finally {
      await owner.query("DROP TABLE platform.added_later");
    }
  });

  it("lets the runtime role keep the pgboss schema it creates itself", async () => {
    await runtime.query("CREATE SCHEMA IF NOT EXISTS pgboss");
    await runtime.query("CREATE TABLE IF NOT EXISTS pgboss.job (id int)");
    await ensureRoles(database);
    await runtime.query(
      "ALTER TABLE pgboss.job ADD COLUMN IF NOT EXISTS name text",
    );
    const kept = await snapshot(database);
    expect(kept).toContainEqual(
      expect.objectContaining({ name: "pgboss", owner: "omnitech" }),
    );
  });

  it("never hands the owner a schema or function the runtime role creates after the split", async () => {
    // A compromised app plants a SECURITY DEFINER function in a schema of its
    // own, hoping the next run of the step makes the owner its owner: the
    // function would then run with the owner's right to disable row-level security.
    await runtime.query("CREATE SCHEMA planted");
    await runtime.query(
      "CREATE FUNCTION planted.disarm() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $body$ BEGIN EXECUTE 'ALTER TABLE platform.tenant_memberships NO FORCE ROW LEVEL SECURITY'; END $body$",
    );
    try {
      await ensureRoles(database);
      await ensureRoles(database);
      expect(await snapshot(database)).toContainEqual(
        expect.objectContaining({ name: "planted", owner: "omnitech" }),
      );
      await expect(
        runtime.query("SELECT planted.disarm()"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtime.query("DROP SCHEMA planted CASCADE");
    }
  });

  it("is safe to run twice: a second run changes no owner, privilege or default", async () => {
    const before = await snapshot(database);
    await ensureRoles(database);
    await ensureRoles(database);
    expect(await snapshot(database)).toEqual(before);
  });

  it("changes no data", async () => {
    const admin = administrator(database);
    try {
      if (existingUser) {
        const rows = await admin.query(
          "SELECT email FROM platform.users WHERE id = $1",
          [existingUser],
        );
        expect(rows.rows).toEqual([{ email: "kept@example.test" }]);
      }
      const history = await admin.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
      );
      expect(history.rows[0]?.count).toBeGreaterThan(20);
    } finally {
      await admin.close();
    }
  });
});
