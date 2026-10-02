# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@omnitech/database` (connectivity, `withTenant()`, Drizzle
migrations) and the empty, secured `interview` and `practice` domain tables
that the Interviews and Practice parts build on.

**Architecture:** A new package owns the pg pool, the only tenant-scoped
Drizzle entry point (`withTenant`), schema-convention helpers and a Drizzle
migration runner. Legacy idempotent SQL keeps running first. Drizzle 1.0 is
baselined from the live dev database with `pull --init`, and its baseline SQL
is replaced by a comment so that fresh databases record it without re-creating
legacy tables. New tables use forced row-level security and composite
`(tenant_id, id)` foreign keys.

**Tech Stack:** TypeScript (ESM, `tsc -b`), pnpm workspaces, turbo, `pg`,
Drizzle ORM and Drizzle Kit 1.0 (pinned exactly), Vitest, Biome, PostgreSQL 15
(local and the disposable test fixture).

**Spec:** `docs/specs/001-foundation.md` · architecture:
`docs/architecture/interview-domain.md`

## Global Constraints

- `drizzle-orm` and `drizzle-kit`: the newest **1.0** release at
  implementation time, **pinned exactly** (no `^`/`~`). It was
  `1.0.0-beta.22` when written. Check with
  `npm view drizzle-orm dist-tags.beta` and use the same version for both.
- Drizzle `schemaFilter: ["platform", "interview", "practice"]`. Never
  introspect or generate for `assistant`, `ai`, `presentation`, `public` or
  `drizzle`.
- Tenant predicate, verbatim:
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
- `withTenant` sets `app.tenant_id` and `app.actor_id` with
  `set_config(…, true)` (transaction-local) only.
- `@omnitech/database` exports **no** module-level Drizzle instance and **no**
  raw `pg` Pool.
- `@omnitech/database` depends only on `pg` and `drizzle-orm`. It must not
  import `@omnitech/platform-storage` or any product.
- Legacy migration SQL files and legacy tables are never modified.
- Tests live in `src/**/*.test.ts`, the only pattern the root Vitest config
  discovers.
- Coverage thresholds (90 lines/functions/statements, 80 branches) must keep
  passing. Pure infrastructure is excluded the way `platform-storage`'s
  `migrate.ts` and the fixture already are.
- Before every commit, run `LC_ALL=en_US.UTF-8 pnpm verify` (the project
  gate). On macOS the disposable Postgres needs a locale.

## Review Focus

1. **A fresh database runs every migration:** a brand-new database gets legacy
   SQL, then all Drizzle migrations including the no-op baseline, without
   "relation already exists". *(Task 3, `migrate.test.ts`)*
2. **A forgotten `withTenant` fails closed:** a query on a new table with no
   tenant context returns nothing, and an insert errors. *(Task 2 and Task 5)*
3. **Pooled connections don't leak:** the same client used as tenant A, then
   B, never sees A's context. *(Task 2)*
4. **Shared catalog rows are read-only to tenants:** a tenant can read an
   exercise with a null `tenant_id` but can't insert, update or delete one.
   *(Task 5)*
5. **Attempts are private per user within a workspace:** a second member of
   the same tenant can't see another member's exercise attempt. *(Task 5)*

---

## File Structure

```
packages/database/                           NEW package @omnitech/database
  package.json · tsconfig.json · drizzle.config.ts
  drizzle/                                   Drizzle migration stream (generated + custom)
  src/
    index.ts                                 public entrypoint
    connection.ts                            PlatformDatabase (moved from platform-storage/src/database.ts) + internal client access
    with-tenant.ts                           withTenant(): the only tenant-scoped Drizzle entry point
    conventions.ts                           tenantPredicate · tenantColumns · tenantPolicy · tenantUnique · tenantReference · timestamps
    drizzle-migrations.ts                    runDrizzleMigrations(): Drizzle migrate() on the stream
    test-support/postgres.ts                 startDisposablePostgres(): generic test Postgres
    connection.test.ts · with-tenant.test.ts · conventions.test.ts
packages/platform-storage/
  src/database.ts                            becomes a re-export of @omnitech/database (compatibility)
  src/schema/platform.ts                     NEW pulled baseline of platform tables
  src/migrate.ts                             legacy SQL, then runDrizzleMigrations()
  src/legacy-migrations.ts                   NEW exported list of legacy SQL file URLs (used by migrate.ts and tests)
  src/migrate.test.ts                        NEW legacy → Drizzle, run twice
  package.json                               add "./schema" export and dependencies
products/interview/
  src/backend/db/legacy.ts                   NEW pulled baseline of legacy interview tables (generated; don't hand-edit)
  src/backend/db/schema.ts                   NEW interview + practice domain tables
  src/backend/db/security.test.ts            NEW isolation suite
  src/backend/assistant/workspace-fixture.ts uses startDisposablePostgres() for the server lifecycle
  package.json                               add dependencies
.rulesync/rules/packages.md                  rule update, then regenerate
vitest.config.ts                             coverage exclusions for new infrastructure
```

---

### Task 1: The `@omnitech/database` package and the moved connection

**Files:**
- Create: `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/src/index.ts`, `packages/database/src/connection.ts`, `packages/database/src/test-support/postgres.ts`, `packages/database/src/connection.test.ts`
- Modify: `packages/platform-storage/src/database.ts` (becomes a re-export), `packages/platform-storage/package.json` (dependency), `vitest.config.ts` (coverage exclusions)

**Interfaces:**
- Produces:
  - `createPlatformDatabase(connectionString?: string): PlatformDatabase`, `getPlatformDatabase(): PlatformDatabase`, `migrateDatabase(client: DatabaseClient, migrationUrl: URL): Promise<void>`, and the types `PlatformDatabase` and `DatabaseClient` (same signatures as today's `platform-storage/src/database.ts`)
  - an internal `withPoolClient<T>(database: PlatformDatabase, fn: (client: PoolClient) => Promise<T>): Promise<T>` (exported from `connection.ts`, **not** from `index.ts`)
  - from `@omnitech/database/test-support`: `startDisposablePostgres(): Promise<DisposablePostgres>`, where `DisposablePostgres = { ownerUrl: string; memberUrl: string; owner: PlatformDatabase; stop(): Promise<void> }`

- [ ] **Step 1: Create the package skeleton**

`packages/database/package.json` (replace `1.0.0-beta.22` with the version from Global Constraints):

```json
{
  "name": "@omnitech/database",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./test-support": {
      "types": "./dist/test-support/postgres.d.ts",
      "import": "./dist/test-support/postgres.js"
    }
  },
  "files": ["dist", "drizzle"],
  "scripts": {
    "build": "tsc -b",
    "lint": "biome lint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config ../../vitest.package.config.ts",
    "db:pull": "drizzle-kit pull --init",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "drizzle-orm": "1.0.0-beta.22",
    "pg": "^8.16.3"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/pg": "^8.15.5",
    "drizzle-kit": "1.0.0-beta.22",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/database/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

Run: `pnpm install`
Expected: the lockfile gains `drizzle-orm`, `drizzle-kit` and `@omnitech/database`, with no errors.

- [ ] **Step 2: Write the failing connection test**

`packages/database/src/connection.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlatformDatabase, withPoolClient } from "./connection.js";
import { type DisposablePostgres, startDisposablePostgres } from "./test-support/postgres.js";

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
    const tenant = await db.tenantTransaction("11111111-1111-1111-1111-111111111111", (c) =>
      c.query("SELECT current_setting('app.tenant_id', true) AS t"),
    );
    expect(tenant.rows[0]).toEqual({ t: "11111111-1111-1111-1111-111111111111" });
    expect(await withPoolClient(db, async (client) => (await client.query("SELECT 1 AS one")).rows)).toEqual([{ one: 1 }]);
  } finally {
    await db.close();
  }
});
```

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run packages/database/src/connection.test.ts`
Expected: FAIL, "Cannot find module './connection.js'"

- [ ] **Step 3: Move the connection code**

Copy `packages/platform-storage/src/database.ts` **verbatim** to `packages/database/src/connection.ts`, then add, below the `PostgresDatabase` class, the internal accessor that `withTenant` (Task 2) uses:

```ts
// Internal: a checked-out client for code inside this package (withTenant).
// Not exported from index.ts, so product code can never hold a raw client.
export async function withPoolClient<T>(
  database: PlatformDatabase,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!(database instanceof PostgresDatabase))
    throw new Error("withPoolClient needs a database from createPlatformDatabase().");
  return database.withClient(fn);
}
```

and this method inside `class PostgresDatabase`:

```ts
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
```

`packages/database/src/index.ts`:

```ts
export {
  createPlatformDatabase,
  type DatabaseClient,
  getPlatformDatabase,
  migrateDatabase,
  type PlatformDatabase,
} from "./connection.js";
```

`packages/platform-storage/src/database.ts`, now a compatibility re-export:

```ts
// Connectivity moved to @omnitech/database; existing imports keep working.
export {
  createPlatformDatabase,
  type DatabaseClient,
  getPlatformDatabase,
  migrateDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
export type { PoolClient } from "pg";
```

Add `"@omnitech/database": "workspace:*"` to `packages/platform-storage/package.json` `dependencies`.

- [ ] **Step 4: Add the generic disposable Postgres**

`packages/database/src/test-support/postgres.ts`. This is the lifecycle logic
from `products/interview/src/backend/assistant/workspace-fixture.ts`, made
generic: it creates the cluster, the non-superuser `fixture_member` role, and
returns connection URLs.

```ts
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { createPlatformDatabase, type PlatformDatabase } from "../connection.js";

const bin = process.env["POSTGRES_BIN"] ?? "/opt/homebrew/opt/postgresql@15/bin";

export interface DisposablePostgres {
  ownerUrl: string;
  memberUrl: string;
  owner: PlatformDatabase;
  stop(): Promise<void>;
}

// A throwaway cluster for one test file. The owner role bypasses nothing it
// shouldn't: tables with FORCE ROW LEVEL SECURITY still apply to it.
// fixture_member is NOSUPERUSER NOBYPASSRLS, like the application role.
export async function startDisposablePostgres(): Promise<DisposablePostgres> {
  const root = await mkdtemp(`${tmpdir()}/omnitech-assistant-pg-`);
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  execFileSync(`${bin}/initdb`, ["-D", `${root}/data`, "--auth=trust", "--username=fixture_owner", "--no-locale"], { stdio: "pipe" });
  const child = spawn(`${bin}/postgres`, ["-D", `${root}/data`, "-p", String(port), "-k", root, "-h", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    // macOS postgres aborts ("became multithreaded") without a valid locale.
    env: { ...process.env, LC_ALL: "C" },
  });
  let log = "";
  child.stdout.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  const ownerUrl = `postgresql://fixture_owner@127.0.0.1:${port}/postgres`;
  const memberUrl = `postgresql://fixture_member@127.0.0.1:${port}/postgres`;
  const owner = createPlatformDatabase(ownerUrl);
  const stop = async () => {
    await owner.close().catch(() => undefined);
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  };
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      try {
        await owner.query("SELECT 1");
        break;
      } catch (error) {
        if (Date.now() >= deadline || child.exitCode !== null)
          throw new Error(`Fixture startup failed: ${log}`, { cause: error });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await owner.query("CREATE ROLE fixture_member LOGIN NOSUPERUSER NOBYPASSRLS");
  } catch (error) {
    await stop();
    throw error;
  }
  return { ownerUrl, memberUrl, owner, stop };
}
```

In `vitest.config.ts` `coverage.exclude`, add next to the existing fixture
line:

```ts
        "packages/database/src/test-support/**",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run packages/database packages/platform-storage`
Expected: PASS (the new test plus the existing platform-storage tests)

Run: `pnpm --filter @omnitech/database build && pnpm --filter @omnitech/platform-storage build && pnpm typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/database packages/platform-storage vitest.config.ts pnpm-lock.yaml
git commit -m "feat(database): add @omnitech/database with the moved connection"
```

---

### Task 2: `withTenant()`

**Files:**
- Create: `packages/database/src/with-tenant.ts`, `packages/database/src/with-tenant.test.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: `withPoolClient`, `getPlatformDatabase`, `PlatformDatabase` (Task 1)
- Produces:
  - `interface TenantContext { tenantId: string; actorId: string }`
  - `type TenantDatabase<S extends Record<string, unknown> = Record<string, never>> = NodePgDatabase<S>`
  - `withTenant<T, S extends Record<string, unknown> = Record<string, never>>(context: TenantContext, work: (db: TenantDatabase<S>) => Promise<T>, options?: { schema?: S; database?: PlatformDatabase }): Promise<T>`

- [ ] **Step 1: Write the failing tests**

`packages/database/src/with-tenant.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlatformDatabase, type PlatformDatabase } from "./connection.js";
import { type DisposablePostgres, startDisposablePostgres } from "./test-support/postgres.js";
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
  await withTenant({ tenantId: A, actorId: actor }, (db) => db.execute(sql`INSERT INTO notes VALUES (${A}, 'a')`), opts());
  await withTenant({ tenantId: B, actorId: actor }, (db) => db.execute(sql`INSERT INTO notes VALUES (${B}, 'b')`), opts());
  const rows = await withTenant({ tenantId: A, actorId: actor }, async (db) =>
    (await db.execute(sql`SELECT body, current_setting('app.actor_id', true) AS actor FROM notes`)).rows, opts());
  expect(rows).toEqual([{ body: "a", actor }]);
});

it("does not leak context into the next transaction on the same pooled connection", async () => {
  await withTenant({ tenantId: A, actorId: actor }, (db) => db.execute(sql`SELECT 1`), opts());
  const leaked = await member.query("SELECT current_setting('app.tenant_id', true) AS t");
  expect(leaked.rows[0]?.["t"] ?? "").toBe("");
  const seen = await withTenant({ tenantId: B, actorId: actor }, async (db) =>
    (await db.execute(sql`SELECT body FROM notes`)).rows, opts());
  expect(seen).toEqual([{ body: "b" }]);
});

it("fails closed without a tenant context", async () => {
  expect((await member.query("SELECT * FROM notes")).rows).toEqual([]);
  await expect(member.query(`INSERT INTO notes VALUES ('${A}', 'x')`)).rejects.toThrow(/row-level security/);
});

it("rolls back the whole unit of work on error", async () => {
  await expect(
    withTenant({ tenantId: A, actorId: actor }, async (db) => {
      await db.execute(sql`INSERT INTO notes VALUES (${A}, 'never')`);
      throw new Error("boom");
    }, opts()),
  ).rejects.toThrow("boom");
  const rows = await withTenant({ tenantId: A, actorId: actor }, async (db) =>
    (await db.execute(sql`SELECT body FROM notes WHERE body = 'never'`)).rows, opts());
  expect(rows).toEqual([]);
});
```

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run packages/database/src/with-tenant.test.ts`
Expected: FAIL, "Cannot find module './with-tenant.js'"

- [ ] **Step 2: Implement**

`packages/database/src/with-tenant.ts`:

```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPlatformDatabase, type PlatformDatabase, withPoolClient } from "./connection.js";

export interface TenantContext {
  tenantId: string;
  actorId: string;
}
export type TenantDatabase<S extends Record<string, unknown> = Record<string, never>> = NodePgDatabase<S>;

// [SAFETY] The only way to get a tenant-scoped Drizzle handle. One transaction
// carries the tenant and actor as transaction-local settings, so row-level
// security applies to every query, and a pooled connection can never carry
// them into the next request.
export async function withTenant<T, S extends Record<string, unknown> = Record<string, never>>(
  context: TenantContext,
  work: (db: TenantDatabase<S>) => Promise<T>,
  options: { schema?: S; database?: PlatformDatabase } = {},
): Promise<T> {
  return withPoolClient(options.database ?? getPlatformDatabase(), async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)",
        [context.tenantId, context.actorId],
      );
      const db = drizzle({ client, ...(options.schema ? { schema: options.schema } : {}) }) as TenantDatabase<S>;
      const result = await work(db);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
```

Add to `packages/database/src/index.ts`:

```ts
export { type TenantContext, type TenantDatabase, withTenant } from "./with-tenant.js";
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run packages/database`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/database
git commit -m "feat(database): withTenant, the only tenant-scoped Drizzle entry point"
```

---

### Task 3: Drizzle baseline and the migration runner

**Files:**
- Create: `packages/database/drizzle.config.ts`, `packages/database/src/drizzle-migrations.ts`, `packages/platform-storage/src/schema/platform.ts` (pulled), `products/interview/src/backend/db/legacy.ts` (pulled), `packages/platform-storage/src/legacy-migrations.ts`, `packages/platform-storage/src/migrate.test.ts`, `packages/database/drizzle/<timestamp>_init/` (pulled)
- Modify: `packages/platform-storage/src/migrate.ts`, `packages/platform-storage/package.json` (`./schema` export, `drizzle-orm`), `packages/database/src/index.ts`, `products/interview/package.json` (dependencies), `vitest.config.ts` (coverage exclusions)

**Interfaces:**
- Consumes: `PlatformDatabase`, `withPoolClient` (Task 1)
- Produces:
  - `runDrizzleMigrations(database: PlatformDatabase): Promise<void>` (from `@omnitech/database`)
  - `legacyMigrations(): readonly URL[]` (from `@omnitech/platform-storage`)
  - from `@omnitech/platform-storage/schema`: the pulled platform tables, including `tenants`, `users` and `tenantMemberships` (columns `tenantId`, `userId`)
  - from `products/interview/src/backend/db/legacy.ts`: `export const interview = pgSchema("interview")`

- [ ] **Step 1: Extract the legacy list and write the failing migration test**

`packages/platform-storage/src/legacy-migrations.ts`. The list moves out of
`migrate.ts` verbatim, so the runner and tests share one source:

```ts
import { assistantMigrations } from "@omnitech-assistant/storage-postgres";

const own = (file: string) => new URL(`../migrations/${file}`, import.meta.url);

// The idempotent SQL that predates Drizzle, in the order it has always run.
export function legacyMigrations(): readonly URL[] {
  return [
    ...["0001_platform.sql", "0002_ai_presentation.sql", "0003_ai_profile_preference.sql"].map(own),
    ...assistantMigrations,
    ...[
      "0004_assistant_interview.sql",
      "0005_assistant_provenance.sql",
      "0006_interview_briefings.sql",
      "0007_assistant_reverts.sql",
      "0008_interview_plans.sql",
      "0009_concept_briefs.sql",
      "0010_rehearsal_sessions.sql",
      "0011_assistant_run_worker.sql",
    ].map(own),
  ];
}
```

Export it from `packages/platform-storage/src/index.ts`:
`export * from "./legacy-migrations.js";`

`packages/platform-storage/src/migrate.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { runDrizzleMigrations } from "@omnitech/database";
import { type DisposablePostgres, startDisposablePostgres } from "@omnitech/database/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import { legacyMigrations } from "./legacy-migrations.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());

it("migrates a fresh database (legacy SQL, then Drizzle) and re-runs as a no-op", async () => {
  for (const file of legacyMigrations()) await pg.owner.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(pg.owner);
  const applied = async () =>
    (await pg.owner.query("SELECT name FROM drizzle.__drizzle_migrations ORDER BY id")).rows.map((r) => r["name"]);
  const first = await applied();
  expect(first.length).toBeGreaterThanOrEqual(1);
  // Legacy SQL and the Drizzle stream run again without errors or new rows.
  for (const file of legacyMigrations()) await pg.owner.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(pg.owner);
  expect(await applied()).toEqual(first);
});
```

Run: `pnpm --filter @omnitech/database build && LC_ALL=en_US.UTF-8 pnpm vitest run packages/platform-storage/src/migrate.test.ts`
Expected: FAIL, "runDrizzleMigrations is not exported"

- [ ] **Step 2: Add the Drizzle config and the runner**

`packages/database/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// One migration stream for the whole database. Schemas stay owned by their
// packages; this file only names them (tooling configuration, not an import).
export default defineConfig({
  dialect: "postgresql",
  schema: [
    "../platform-storage/src/schema/platform.ts",
    "../../products/interview/src/backend/db/legacy.ts",
    "../../products/interview/src/backend/db/schema.ts",
  ],
  out: "./drizzle",
  schemaFilter: ["platform", "interview", "practice"],
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://omnitech:omnitech@127.0.0.1:5432/omnitech",
  },
});
```

`packages/database/src/drizzle-migrations.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { type PlatformDatabase, withPoolClient } from "./connection.js";

// The Drizzle stream ships beside dist (package "files": ["dist", "drizzle"]).
const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;

// Applies Drizzle migrations not yet recorded (by name) in
// drizzle.__drizzle_migrations. Run after the legacy SQL.
export async function runDrizzleMigrations(database: PlatformDatabase): Promise<void> {
  await withPoolClient(database, (client) =>
    migrate(drizzle({ client }), { migrationsFolder, migrationsSchema: "drizzle", migrationsTable: "__drizzle_migrations" }).then(() => undefined),
  );
}
```

Add `export { runDrizzleMigrations } from "./drizzle-migrations.js";` to
`packages/database/src/index.ts`. In `vitest.config.ts` `coverage.exclude`,
add `"packages/database/src/drizzle-migrations.ts",`, next to the existing
`platform-storage/src/migrate.ts` line. It's exercised by `migrate.test.ts`
from another package, which per-package coverage doesn't attribute.

- [ ] **Step 3: Take the baseline from the dev database**

The dev database must be fully migrated by the legacy runner (it is, if
`pnpm dev` has run). Then:

Run: `pnpm --filter @omnitech/database exec drizzle-kit pull --init --schemaFilters platform,interview`
Expected:
- `packages/database/drizzle/<timestamp>_<name>/` with `migration.sql` and `snapshot.json`
- `packages/database/drizzle/schema.ts` (and possibly `relations.ts`)
- a row recorded in `drizzle.__drizzle_migrations`

Verify the row: `psql postgresql://omnitech:omnitech@127.0.0.1:5432/omnitech -Atc "SELECT name FROM drizzle.__drizzle_migrations"`
Expected: one row, whose name matches the new folder.

- [ ] **Step 4: Move the pulled TypeScript into the owning packages**

- Move every `platform`-schema object (the `pgSchema("platform")` constant,
  enums and tables) from `packages/database/drizzle/schema.ts` into
  `packages/platform-storage/src/schema/platform.ts`.
- Move every `interview`-schema object into
  `products/interview/src/backend/db/legacy.ts`, starting with
  `// Generated by drizzle-kit pull --init. Do not edit by hand.`
- Make sure the schema constants are exported as `platform` and `interview`.
  Rename them if pull chose other names.
- In `legacy.ts`, import any platform tables it references from
  `@omnitech/platform-storage/schema`.
- Delete `packages/database/drizzle/schema.ts` and `relations.ts`.

Add to `packages/platform-storage/package.json` `exports`:

```json
    "./schema": { "types": "./dist/schema/platform.d.ts", "import": "./dist/schema/platform.js" }
```

Add `"drizzle-orm": "1.0.0-beta.22"` (the pinned version) to the
`dependencies` of `packages/platform-storage/package.json` and
`products/interview/package.json`, and add `"@omnitech/database": "workspace:*"`
and `"@omnitech/platform-storage": "workspace:*"` to
`products/interview/package.json` if they're missing. Then run
`pnpm install`.

Run: `pnpm biome format --write packages/platform-storage/src/schema products/interview/src/backend/db && pnpm --filter @omnitech/platform-storage build`
Expected: builds cleanly

- [ ] **Step 5: Make the baseline a recorded no-op**

Replace the entire contents of
`packages/database/drizzle/<timestamp>_<name>/migration.sql` with:

```sql
-- Baseline. These objects are created by the legacy SQL migrations
-- (packages/platform-storage/migrations 0001–0011 and the assistant's), which
-- always run first. Drizzle records this migration by name: on the dev
-- database `pull --init` already did; on a fresh database this no-op records it.
SELECT 1;
```

Keep `snapshot.json` unchanged, because `drizzle-kit generate` diffs against it.

- [ ] **Step 6: Prove the baseline matches the database**

Run: `pnpm --filter @omnitech/database exec drizzle-kit generate --name=baseline_check`
Expected: "No schema changes" (or equivalent), and **no** new migration folder.
If one appears, the moved schema differs from the pulled snapshot. Fix the TypeScript (not the snapshot), delete the folder, and run again.

- [ ] **Step 7: Switch the runner and run the tests**

`packages/platform-storage/src/migrate.ts`:

```ts
import { readFile } from "node:fs/promises";
import { runDrizzleMigrations } from "@omnitech/database";
import { createPlatformDatabase } from "./database.js";
import { legacyMigrations } from "./legacy-migrations.js";

const database = createPlatformDatabase();

// Legacy idempotent SQL first, then the Drizzle stream (applied once each).
try {
  for (const file of legacyMigrations()) await database.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(database);
} finally {
  await database.close();
}
```

Run: `pnpm --filter @omnitech/database build && LC_ALL=en_US.UTF-8 pnpm vitest run packages/platform-storage packages/database`
Expected: PASS, including `migrate.test.ts`

Run: `pnpm --filter @omnitech/platform-storage db:migrate`
Expected: exits 0 against the dev database, with no new `drizzle.__drizzle_migrations` rows.

- [ ] **Step 8: Commit**

```bash
git add packages/database packages/platform-storage products/interview/package.json products/interview/src/backend/db/legacy.ts vitest.config.ts pnpm-lock.yaml
git commit -m "feat(database): Drizzle 1.0 baseline from the live schema, run after legacy SQL"
```

---

### Task 4: Conventions and the domain schema (`0012` and `0013`)

**Files:**
- Create: `packages/database/src/conventions.ts`, `packages/database/src/conventions.test.ts`, `products/interview/src/backend/db/schema.ts`, `packages/database/drizzle/<ts>_domain_schema/` (generated), `packages/database/drizzle/<ts>_force_rls/` (custom)
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: the `platform` tables `tenants`, `users`, `tenantMemberships` (Task 3); the `interview` pgSchema from `legacy.ts` (Task 3)
- Produces, from `@omnitech/database`: `tenantPredicate(column)`, `actorPredicate(column)`, `timestamps()`, `tenantColumns(platform: PlatformTables)`, `tenantPolicy(table: string, tenantId)`, `tenantUnique(table: string, tenantId, id)`, `tenantReference(name: string, columns: [tenantId, refId], parent: [tenantId, id])`, `interface PlatformTables { tenants: { id: AnyPgColumn }; users: { id: AnyPgColumn } }`.
- Produces, from `products/interview/src/backend/db/schema.ts`: `companies`, `people`, `memberPeople`, `candidacies`, `interviews`, `interviewParticipants`, `briefingLinks`, `practice`, `exercises`, `exerciseAttempts`, the enums, and `domainTables` (the array of tenant-owned tables, used by Task 5).

- [ ] **Step 1: Write the failing conventions test**

`packages/database/src/conventions.test.ts`:

```ts
import { getTableConfig, pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { tenantColumns, tenantPolicy, tenantReference, tenantUnique } from "./conventions.js";

const platform = pgSchema("platform");
const tenants = platform.table("tenants", { id: uuid("id").primaryKey() });
const users = platform.table("users", { id: uuid("id").primaryKey() });
const s = pgSchema("s");
const parent = s.table.withRLS("parent", { ...tenantColumns({ tenants, users }) }, (t) => [
  tenantUnique("parent", t.tenantId, t.id),
  tenantPolicy("parent", t.tenantId),
]);
const child = s.table.withRLS("child", { ...tenantColumns({ tenants, users }), parentId: uuid("parent_id"), note: text("note") }, (t) => [
  tenantReference("child_parent_fkey", [t.tenantId, t.parentId], [parent.tenantId, parent.id]),
  tenantPolicy("child", t.tenantId),
]);

it("gives tenant-owned tables the id, tenant, author, timestamps, unique key, policy and composite FK", () => {
  const p = getTableConfig(parent);
  expect(p.columns.map((c) => c.name).sort()).toEqual(["created_at", "created_by", "id", "tenant_id", "updated_at"]);
  expect(p.uniqueConstraints.map((u) => u.columns.map((c) => c.name))).toEqual([["tenant_id", "id"]]);
  expect(p.policies.map((x) => x.name)).toEqual(["tenant_parent"]);
  expect(p.enableRLS).toBe(true);
  const c = getTableConfig(child);
  const composite = c.foreignKeys.find((fk) => fk.getName() === "child_parent_fkey")!;
  expect(composite.reference().columns.map((x) => x.name)).toEqual(["tenant_id", "parent_id"]);
  expect(composite.reference().foreignColumns.map((x) => x.name)).toEqual(["tenant_id", "id"]);
});
```

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run packages/database/src/conventions.test.ts`
Expected: FAIL, "Cannot find module './conventions.js'"

- [ ] **Step 2: Implement the conventions**

`packages/database/src/conventions.ts`:

```ts
import { sql } from "drizzle-orm";
import { type AnyPgColumn, foreignKey, type PgColumn, pgPolicy, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// Plain helpers for tenant-owned tables (see docs/specs/001-foundation.md).
// The platform tables are arguments, so this package never imports
// @omnitech/platform-storage.
export interface PlatformTables {
  tenants: { id: AnyPgColumn };
  users: { id: AnyPgColumn };
}

export const tenantPredicate = (tenantId: AnyPgColumn) =>
  sql`${tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`;
export const actorPredicate = (userId: AnyPgColumn) =>
  sql`${userId} = nullif(current_setting('app.actor_id', true), '')::uuid`;

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantColumns = ({ tenants, users }: PlatformTables) => ({
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps(),
});

// USING and WITH CHECK both pin rows to the transaction's tenant.
export const tenantPolicy = (table: string, tenantId: AnyPgColumn) =>
  pgPolicy(`tenant_${table}`, { as: "permissive", for: "all", using: tenantPredicate(tenantId), withCheck: tenantPredicate(tenantId) });

// UNIQUE (tenant_id, id): the target of composite foreign keys.
export const tenantUnique = (table: string, tenantId: PgColumn, id: PgColumn) =>
  unique(`${table}_tenant_id_id_key`).on(tenantId, id);

// FOREIGN KEY (tenant_id, x_id) → parent (tenant_id, id): a row can never
// reference a row in another workspace.
export const tenantReference = (name: string, columns: [PgColumn, PgColumn], parent: [PgColumn, PgColumn]) =>
  foreignKey({ name, columns, foreignColumns: parent });
```

Add to `packages/database/src/index.ts`:

```ts
export {
  actorPredicate,
  type PlatformTables,
  tenantColumns,
  tenantPolicy,
  tenantPredicate,
  tenantReference,
  tenantUnique,
  timestamps,
} from "./conventions.js";
```

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run packages/database/src/conventions.test.ts`
Expected: PASS

- [ ] **Step 3: Write the domain schema**

`products/interview/src/backend/db/schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgPolicy, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { actorPredicate, tenantColumns, tenantPolicy, tenantPredicate, tenantReference, tenantUnique, timestamps } from "@omnitech/database";
import { tenantMemberships, tenants, users } from "@omnitech/platform-storage/schema";
import { interview } from "./legacy.js";

const platform = { tenants, users };

export const candidacyStatus = interview.enum("candidacy_status", ["exploring", "applied", "interviewing", "offer", "accepted", "declined", "rejected", "withdrawn", "on_hold"]);
export const candidacySource = interview.enum("candidacy_source", ["recruiter_outreach", "referral", "applied", "inbound"]);
export const interviewKind = interview.enum("interview_kind", ["recruiter_screen", "hiring_manager", "technical", "system_design", "take_home", "panel", "final", "other"]);
export const interviewFormat = interview.enum("interview_format", ["video", "phone", "onsite"]);
export const interviewStatus = interview.enum("interview_status", ["scheduled", "completed", "cancelled", "no_show"]);
export const participantRole = interview.enum("participant_role", ["candidate", "interviewer", "recruiter", "hiring_manager", "coordinator", "observer", "other"]);

export const companies = interview.table.withRLS("companies", {
  ...tenantColumns(platform),
  name: text("name").notNull(),
  domain: text("domain"),
  notes: text("notes"),
  research: text("research"),
}, (t) => [
  tenantUnique("companies", t.tenantId, t.id),
  uniqueIndex("companies_tenant_domain_key").on(t.tenantId, t.domain).where(sql`${t.domain} IS NOT NULL`),
  tenantPolicy("companies", t.tenantId),
]);

export const people = interview.table.withRLS("people", {
  ...tenantColumns(platform),
  fullName: text("full_name").notNull(),
  title: text("title"),
  companyId: uuid("company_id"),
  linkedinUrl: text("linkedin_url"),
  linkedUserId: uuid("linked_user_id").references(() => users.id),
  notes: text("notes"),
}, (t) => [
  tenantUnique("people", t.tenantId, t.id),
  tenantReference("people_company_fkey", [t.tenantId, t.companyId], [companies.tenantId, companies.id]),
  tenantPolicy("people", t.tenantId),
]);

// "Me": maps a signed-in member of the workspace to their Person.
export const memberPeople = interview.table.withRLS("member_people", {
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  personId: uuid("person_id").notNull(),
  ...timestamps(),
}, (t) => [
  primaryKey({ name: "member_people_pkey", columns: [t.tenantId, t.userId] }),
  unique("member_people_tenant_person_key").on(t.tenantId, t.personId),
  foreignKey({ name: "member_people_membership_fkey", columns: [t.tenantId, t.userId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }).onDelete("cascade"),
  tenantReference("member_people_person_fkey", [t.tenantId, t.personId], [people.tenantId, people.id]),
  tenantPolicy("member_people", t.tenantId),
]);

export const candidacies = interview.table.withRLS("candidacies", {
  ...tenantColumns(platform),
  companyId: uuid("company_id").notNull(),
  candidatePersonId: uuid("candidate_person_id").notNull(),
  title: text("title").notNull(),
  status: candidacyStatus("status").notNull().default("exploring"),
  source: candidacySource("source"),
  postingUrl: text("posting_url"),
  notes: text("notes"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [
  tenantUnique("candidacies", t.tenantId, t.id),
  tenantReference("candidacies_company_fkey", [t.tenantId, t.companyId], [companies.tenantId, companies.id]),
  tenantReference("candidacies_candidate_fkey", [t.tenantId, t.candidatePersonId], [people.tenantId, people.id]),
  tenantPolicy("candidacies", t.tenantId),
]);

export const interviews = interview.table.withRLS("interviews", {
  ...tenantColumns(platform),
  candidacyId: uuid("candidacy_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: interviewKind("kind").notNull(),
  label: text("label").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  format: interviewFormat("format"),
  status: interviewStatus("status").notNull().default("scheduled"),
}, (t) => [
  tenantUnique("interviews", t.tenantId, t.id),
  unique("interviews_candidacy_ordinal_key").on(t.candidacyId, t.ordinal),
  tenantReference("interviews_candidacy_fkey", [t.tenantId, t.candidacyId], [candidacies.tenantId, candidacies.id]),
  check("interviews_duration_check", sql`${t.durationMinutes} IS NULL OR ${t.durationMinutes} BETWEEN 5 AND 480`),
  tenantPolicy("interviews", t.tenantId),
]);

export const interviewParticipants = interview.table.withRLS("interview_participants", {
  ...tenantColumns(platform),
  interviewId: uuid("interview_id").notNull(),
  personId: uuid("person_id").notNull(),
  role: participantRole("role").notNull(),
  roleLabel: text("role_label"),
}, (t) => [
  tenantUnique("interview_participants", t.tenantId, t.id),
  unique("interview_participants_unique_key").on(t.interviewId, t.personId, t.role),
  tenantReference("interview_participants_interview_fkey", [t.tenantId, t.interviewId], [interviews.tenantId, interviews.id]),
  tenantReference("interview_participants_person_fkey", [t.tenantId, t.personId], [people.tenantId, people.id]),
  check("interview_participants_other_label_check", sql`${t.role} <> 'other' OR ${t.roleLabel} IS NOT NULL`),
  tenantPolicy("interview_participants", t.tenantId),
]);

// A standalone briefing pack, optionally linked into the domain. briefing_id
// is the pack's existing artifact id (legacy per-actor key, so no FK).
export const briefingLinks = interview.table.withRLS("briefing_links", {
  ...tenantColumns(platform),
  briefingId: text("briefing_id").notNull(),
  candidacyId: uuid("candidacy_id"),
  interviewId: uuid("interview_id"),
}, (t) => [
  tenantUnique("briefing_links", t.tenantId, t.id),
  unique("briefing_links_briefing_key").on(t.tenantId, t.briefingId),
  tenantReference("briefing_links_candidacy_fkey", [t.tenantId, t.candidacyId], [candidacies.tenantId, candidacies.id]),
  tenantReference("briefing_links_interview_fkey", [t.tenantId, t.interviewId], [interviews.tenantId, interviews.id]),
  check("briefing_links_target_check", sql`${t.candidacyId} IS NOT NULL OR ${t.interviewId} IS NOT NULL`),
  tenantPolicy("briefing_links", t.tenantId),
]);

export const practice = pgSchema("practice");
export const exerciseKind = practice.enum("exercise_kind", ["algorithm", "data_structure", "backend", "frontend", "react", "sql", "testing", "other"]);
export const exerciseDifficulty = practice.enum("exercise_difficulty", ["easy", "medium", "hard"]);
export const exerciseSource = practice.enum("exercise_source", ["original", "generated", "user_submitted"]);

// tenant_id NULL = shared catalog (read by everyone, written by no tenant);
// set = private to that workspace.
export const exercises = practice.table.withRLS("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  promptKey: text("prompt_key").notNull(),
  kind: exerciseKind("kind").notNull(),
  difficulty: exerciseDifficulty("difficulty"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  sourceKind: exerciseSource("source_kind").notNull(),
  sourceUrl: text("source_url"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps(),
}, (t) => [
  uniqueIndex("exercises_scope_slug_key").on(sql`coalesce(${t.tenantId}::text, '')`, t.slug),
  index("exercises_tenant_prompt_key_idx").on(t.tenantId, t.promptKey),
  pgPolicy("exercises_read", { as: "permissive", for: "select", using: sql`${t.tenantId} IS NULL OR ${tenantPredicate(t.tenantId)}` }),
  pgPolicy("exercises_write", { as: "permissive", for: "all", using: tenantPredicate(t.tenantId), withCheck: tenantPredicate(t.tenantId) }),
]);

// An attempt is one of the user's existing Workspace drafts (draft_id, legacy
// per-actor key, so no FK) solving an exercise in a language. Private to its user.
export const exerciseAttempts = practice.table.withRLS("exercise_attempts", {
  ...tenantColumns(platform),
  userId: uuid("user_id").notNull().references(() => users.id),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  language: text("language").notNull(),
  draftId: text("draft_id").notNull(),
}, (t) => [
  tenantUnique("exercise_attempts", t.tenantId, t.id),
  unique("exercise_attempts_draft_key").on(t.tenantId, t.userId, t.draftId),
  pgPolicy("tenant_user_exercise_attempts", {
    as: "permissive",
    for: "all",
    using: sql`${tenantPredicate(t.tenantId)} AND ${actorPredicate(t.userId)}`,
    withCheck: sql`${tenantPredicate(t.tenantId)} AND ${actorPredicate(t.userId)}`,
  }),
]);

// Every tenant-owned domain table (shared exercises excluded); Task 5 iterates it.
export const domainTables = [companies, people, memberPeople, candidacies, interviews, interviewParticipants, briefingLinks, exerciseAttempts] as const;
```

Run: `pnpm --filter @omnitech/database build && pnpm --filter @omnitech/platform-storage build && pnpm --filter @omnitech/product-interview typecheck`
Expected: no errors

- [ ] **Step 4: Generate 0012**

Run: `pnpm --filter @omnitech/database exec drizzle-kit generate --name=domain_schema`
Expected: one new folder `<ts>_domain_schema/` whose `migration.sql` creates:
- `SCHEMA "practice"`
- the 9 enums and 9 tables
- the policies, `ENABLE ROW LEVEL SECURITY` on each table
- the unique keys, the checks and the composite foreign keys

It must contain **no** statement touching a legacy table. Read it through.

- [ ] **Step 5: Write 0013 by hand**

Run: `pnpm --filter @omnitech/database exec drizzle-kit generate --custom --name=force_rls`
Then replace the new `migration.sql` with:

```sql
-- Forced row-level security binds the table owner too. Reviewed by hand,
-- never generated: one ENABLE + FORCE pair per new table.
ALTER TABLE "interview"."companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."companies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."people" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."member_people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."member_people" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."candidacies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."candidacies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interview_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."interview_participants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "interview"."briefing_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interview"."briefing_links" FORCE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercises" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercises" FORCE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercise_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice"."exercise_attempts" FORCE ROW LEVEL SECURITY;
```

- [ ] **Step 6: Apply and check idempotency**

Run: `pnpm --filter @omnitech/database build && LC_ALL=en_US.UTF-8 pnpm vitest run packages/platform-storage/src/migrate.test.ts packages/database`
Expected: PASS. A fresh database applies the baseline, 0012 and 0013, and a second run records nothing new.

Run: `pnpm --filter @omnitech/platform-storage db:migrate`
Expected: exits 0, and the dev database gains the two new migration rows.

- [ ] **Step 7: Commit**

```bash
git add packages/database products/interview/src/backend/db/schema.ts
git commit -m "feat(interview): domain and practice tables with forced RLS and composite tenant keys"
```

---

### Task 5: The isolation suite

**Files:**
- Create: `products/interview/src/backend/db/security.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `runDrizzleMigrations`, `createPlatformDatabase` (`@omnitech/database`); `startDisposablePostgres` (`@omnitech/database/test-support`); `legacyMigrations` (`@omnitech/platform-storage`); the tables and `domainTables` (Task 4)
- Produces: nothing new (tests only)

- [ ] **Step 1: Write the suite**

`products/interview/src/backend/db/security.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { createPlatformDatabase, type PlatformDatabase, runDrizzleMigrations, type TenantDatabase, withTenant } from "@omnitech/database";
import { type DisposablePostgres, startDisposablePostgres } from "@omnitech/database/test-support";
import { legacyMigrations } from "@omnitech/platform-storage";
import { eq, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema.js";

let pg: DisposablePostgres;
let member: PlatformDatabase;
const ids = { tenantA: "", tenantB: "", alice: "", bob: "", carol: "" };

beforeAll(async () => {
  pg = await startDisposablePostgres();
  for (const file of legacyMigrations()) await pg.owner.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, interview, practice TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA interview, practice TO fixture_member;
    GRANT SELECT ON ALL TABLES IN SCHEMA platform TO fixture_member;`);
  // Platform rows: tenants A and B; alice and carol in A, bob in B.
  const one = async (q: string) => String((await pg.owner.query(q)).rows[0]?.["id"]);
  ids.tenantA = await one("INSERT INTO platform.tenants (slug, name) VALUES ('a', 'A') RETURNING id");
  ids.tenantB = await one("INSERT INTO platform.tenants (slug, name) VALUES ('b', 'B') RETURNING id");
  ids.alice = await one("INSERT INTO platform.users (email, display_name) VALUES ('alice@x', 'Alice') RETURNING id");
  ids.bob = await one("INSERT INTO platform.users (email, display_name) VALUES ('bob@x', 'Bob') RETURNING id");
  ids.carol = await one("INSERT INTO platform.users (email, display_name) VALUES ('carol@x', 'Carol') RETURNING id");
  await pg.owner.query(
    `INSERT INTO platform.tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')`,
    [ids.tenantA, ids.alice, ids.carol, ids.tenantB, ids.bob],
  );
  member = createPlatformDatabase(pg.memberUrl);
}, 60_000);
afterAll(async () => {
  await member?.close();
  await pg?.stop();
});

const as = <T>(tenantId: string, actorId: string, work: (db: TenantDatabase) => Promise<T>) =>
  withTenant({ tenantId, actorId }, work, { database: member });

// Drizzle wraps database errors; the Postgres message may be on `cause`.
async function expectFailure(work: Promise<unknown>, pattern: RegExp) {
  const error = await work.then(() => undefined, (e: unknown) => e);
  expect(error).toBeDefined();
  const text = `${(error as Error).message} ${(error as { cause?: Error }).cause?.message ?? ""}`;
  expect(text).toMatch(pattern);
}

async function seedCompany(tenantId: string, actorId: string, name: string) {
  return as(tenantId, actorId, async (db) => (await db.insert(schema.companies).values({ tenantId, name, createdBy: actorId }).returning())[0]!);
}

describe("tenant isolation", () => {
  it("1: a tenant sees only its own rows", async () => {
    await seedCompany(ids.tenantA, ids.alice, "Acme");
    await seedCompany(ids.tenantB, ids.bob, "Beta");
    const names = await as(ids.tenantA, ids.alice, async (db) => (await db.select().from(schema.companies)).map((c) => c.name));
    expect(names).toEqual(["Acme"]);
  });

  it("2: a tenant cannot insert rows for another tenant", async () => {
    await expectFailure(
      as(ids.tenantA, ids.alice, (db) => db.insert(schema.companies).values({ tenantId: ids.tenantB, name: "Sneaky" })),
      /row-level security/,
    );
  });

  it("3: a tenant cannot update or delete another tenant's rows", async () => {
    const beta = await seedCompany(ids.tenantB, ids.bob, "Beta2");
    const updated = await as(ids.tenantA, ids.alice, (db) => db.update(schema.companies).set({ name: "Owned" }).where(eq(schema.companies.id, beta.id)).returning());
    const deleted = await as(ids.tenantA, ids.alice, (db) => db.delete(schema.companies).where(eq(schema.companies.id, beta.id)).returning());
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it("4: a row cannot reference a parent in another tenant (composite FK)", async () => {
    const beta = await seedCompany(ids.tenantB, ids.bob, "Beta3");
    await expectFailure(
      as(ids.tenantA, ids.alice, (db) => db.insert(schema.people).values({ tenantId: ids.tenantA, fullName: "X", companyId: beta.id })),
      /foreign key/,
    );
  });

  it("5: with no tenant context nothing is visible and writes fail", async () => {
    expect((await member.query("SELECT * FROM interview.companies")).rows).toEqual([]);
    await expect(member.query(`INSERT INTO interview.companies (tenant_id, name) VALUES ('${ids.tenantA}', 'Nope')`)).rejects.toThrow(/row-level security/);
  });

  it("6: a pooled connection does not keep the previous tenant", async () => {
    await as(ids.tenantA, ids.alice, (db) => db.execute(sql`SELECT 1`));
    const names = await as(ids.tenantB, ids.bob, async (db) => (await db.select().from(schema.companies)).map((c) => c.name));
    expect(names.every((n) => n.startsWith("Beta"))).toBe(true);
  });

  it("7: forced row-level security binds the table owner", async () => {
    expect((await pg.owner.query("SELECT * FROM interview.companies")).rows).toEqual([]);
  });
});

describe("practice", () => {
  it("8: shared exercises are readable but not writable by a tenant", async () => {
    // Shared rows are seeded the way a maintainer migration must: the owner
    // lifts FORCE for the insert, since no tenant may write a shared row.
    await pg.owner.query(`
      SELECT set_config('app.tenant_id', '', false);
      ALTER TABLE practice.exercises NO FORCE ROW LEVEL SECURITY;
      INSERT INTO practice.exercises (slug, title, prompt, prompt_key, kind, source_kind) VALUES ('two-sum', 'Two Sum', 'p', 'p', 'algorithm', 'original');
      ALTER TABLE practice.exercises FORCE ROW LEVEL SECURITY;`);
    const seen = await as(ids.tenantA, ids.alice, async (db) => (await db.select().from(schema.exercises)).map((e) => e.slug));
    expect(seen).toContain("two-sum");
    await expectFailure(
      as(ids.tenantA, ids.alice, (db) =>
        db.insert(schema.exercises).values({ slug: "x", title: "x", prompt: "x", promptKey: "x", kind: "algorithm", sourceKind: "original" })),
      /row-level security/,
    );
    const changed = await as(ids.tenantA, ids.alice, (db) => db.update(schema.exercises).set({ title: "Mine" }).where(eq(schema.exercises.slug, "two-sum")).returning());
    expect(changed).toEqual([]);
  });

  it("9: an attempt is private to its user within the workspace", async () => {
    const exercise = await as(ids.tenantA, ids.alice, async (db) => (await db.insert(schema.exercises).values({
      tenantId: ids.tenantA, slug: "private-q", title: "Q", prompt: "q", promptKey: "q", kind: "algorithm", sourceKind: "user_submitted",
    }).returning())[0]!);
    await as(ids.tenantA, ids.alice, (db) => db.insert(schema.exerciseAttempts).values({
      tenantId: ids.tenantA, userId: ids.alice, exerciseId: exercise.id, language: "typescript", draftId: "q-1",
    }));
    const forCarol = await as(ids.tenantA, ids.carol, (db) => db.select().from(schema.exerciseAttempts));
    expect(forCarol).toEqual([]);
    const forAlice = await as(ids.tenantA, ids.alice, (db) => db.select().from(schema.exerciseAttempts));
    expect(forAlice).toHaveLength(1);
  });
});

it("11: every reference between tenant-owned tables uses the composite tenant key", () => {
  const tenantOwned = new Set(schema.domainTables.map((t) => getTableName(t)));
  for (const table of schema.domainTables) {
    for (const fk of getTableConfig(table).foreignKeys) {
      const ref = fk.reference();
      const target = getTableName(ref.foreignTable);
      if (!tenantOwned.has(target)) continue;
      expect([getTableName(table), ref.columns[0]?.name, ref.foreignColumns[0]?.name]).toEqual([getTableName(table), "tenant_id", "tenant_id"]);
    }
  }
});
```

Spec case 10 (legacy-migrated, then migrated again) is `packages/platform-storage/src/migrate.test.ts` from Task 3.

- [ ] **Step 2: Run the suite**

Run: `pnpm --filter @omnitech/database build && pnpm --filter @omnitech/platform-storage build && LC_ALL=en_US.UTF-8 pnpm vitest run products/interview/src/backend/db/security.test.ts`
Expected: PASS (10 tests)

If a case fails, fix the **schema or migration**, never the assertion. These
cases are the authorization contract.

- [ ] **Step 3: Commit**

```bash
git add products/interview/src/backend/db/security.test.ts
git commit -m "test(interview): tenant isolation, shared catalog and per-user attempt privacy"
```

---

### Task 6: Share the fixture, update the package rule, verify

**Files:**
- Modify: `products/interview/src/backend/assistant/workspace-fixture.ts`, `.rulesync/rules/packages.md`, `.rulesync/rules/overview.md` (only if it repeats the old wording)
- Regenerated: the rulesync outputs (`.claude/rules/*.md` and the other targets)

**Interfaces:**
- Consumes: `startDisposablePostgres` (Task 1)
- Produces: nothing new. `disposablePostgres()` keeps its exact exported API.

- [ ] **Step 1: Make the interview fixture use the shared lifecycle**

In `products/interview/src/backend/assistant/workspace-fixture.ts`, replace
the server-lifecycle part with a call to the shared helper, and keep
everything it returns the same:
- the `mkdtemp`, `createServer` and port probing
- the `initdb`, `spawn` and readiness loop
- `CREATE ROLE fixture_member`

At the top of `disposablePostgres()`:

```ts
  const server = await startDisposablePostgres();
  const owner = new URL(server.ownerUrl);
  const config = { host: owner.hostname, port: Number(owner.port), user: "fixture_owner", database: "postgres" };
  const admin = new Pool(config);
  const member = new Pool({ ...config, user: "fixture_member" });
```

Its `close()`/teardown calls `await admin.end(); await member.end(); await server.stop();`.
Keep `transaction`, `database`, `worker`, `migrate` and the other returned
fields unchanged. Add `"@omnitech/database": "workspace:*"` to
`products/interview/package.json` `devDependencies` if it isn't already a
dependency, and import
`import { startDisposablePostgres } from "@omnitech/database/test-support";`.

Run: `LC_ALL=en_US.UTF-8 pnpm vitest run products/interview --no-file-parallelism`
Expected: PASS. All existing interview tests run unchanged on the shared lifecycle.

- [ ] **Step 2: Update the package rule**

In `.rulesync/rules/packages.md`, replace the line beginning
`` - `platform-storage` owns PostgreSQL access, tenant transactions, migrations, `` (including its continuation line) with:

```md
- `database` owns PostgreSQL connectivity, tenant-scoped transactions
  (`withTenant`) and migration execution; domain packages (`platform-storage`,
  `products/*`) own their schemas and repositories.
- `platform-storage` owns the platform schema, platform repositories,
  encryption boundaries and the legacy migration list.
```

Run: `pnpm rulesync:generate`
Expected: `.claude/rules/packages.md` and the other generated targets show the new wording, with no other diffs.

- [ ] **Step 3: Run the full gate**

Run: `LC_ALL=en_US.UTF-8 pnpm verify`
Expected: lint, format, typecheck, tests with coverage (thresholds met) and build all pass.

Run: `pnpm dev` (stop it once "Ready" appears)
Expected: migrations apply, the app starts, and the briefing and Workspace pages load as before.

- [ ] **Step 4: Commit**

```bash
git add products/interview .rulesync .claude .agents .cursor .codex .opencode AGENTS.md CLAUDE.md 2>/dev/null; git add -u
git commit -m "chore: share the Postgres fixture; database owns connectivity and migrations"
```
