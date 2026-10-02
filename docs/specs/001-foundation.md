# 001 — Foundation

Part 1 of [the interview domain architecture](../architecture/interview-domain.md).

**Goal:** the database package, Drizzle, `withTenant()`, and the empty but
secured tables that parts 2 (Interviews) and 3 (Practice) build on. This part
ships no user-facing feature.

## Existing state

- **Data access:** `pg` with hand-written SQL. There is no ORM.
- **`platform-storage`** owns the pool and `tenantTransaction(tenantId, fn)`,
  which sets `app.tenant_id` for the transaction alone.
- **`migrate.ts`** re-runs a hard-coded list of idempotent SQL files on every
  start: platform `0001`–`0003`, then the Assistant's migrations, then
  interview `0004`–`0011`. Nothing records which have been applied.
- **Platform tables** use tenant-only row-level security. Interview tables
  are private per actor.
- **`tenant_memberships.role`** is already `platform.tenant_role`
  (`owner | admin | member`), required, with no default.
- **Tests** use a disposable Postgres fixture
  (`products/interview/src/backend/assistant/workspace-fixture.ts`), which
  needs `LC_ALL` set on macOS.

## Package changes

```
packages/database/            NEW  @omnitech/database
  drizzle.config.ts
  drizzle/                    the migration stream
  src/
    connection.ts             the pool (moved from platform-storage)
    with-tenant.ts            withTenant(): the only tenant-scoped entry point
    conventions.ts            tenantColumns · tenantPolicy · tenantReference · …
    drizzle-migrations.ts     runDrizzleMigrations()          → "@omnitech/database/migrate"
    test-support/postgres.ts  disposable Postgres (moved)      → "@omnitech/database/test-support"
    index.ts                                                   → "@omnitech/database"

packages/platform-storage/src/
  schema/platform.ts          NEW  baseline of platform tables
  legacy-migrations.ts        the legacy SQL list (platform, Assistant, interview)
  migrate.ts                  legacy SQL, then runDrizzleMigrations()
products/interview/src/backend/db/
  legacy.ts                   NEW  pulled baseline of the legacy interview tables
  schema.ts                   NEW  interview + practice tables
  security.test.ts            the security suite below
```

**Public surface of `@omnitech/database`:** `withTenant`, `TenantContext`,
`TenantDatabase`, the convention helpers, and `createPlatformDatabase` /
`getPlatformDatabase` / `migrateDatabase` (raw `query` access to the pool,
used by `platform-storage`'s existing repositories). No Drizzle handle and no
`pg` `Pool` or client is exported; the checked-out client stays private to
the package.

**Dependencies:**
- `@omnitech/database` depends only on `pg` and `drizzle-orm`. It also has a
  `zod: catalog:` devDependency so drizzle-orm's optional zod peer resolves
  to the workspace's single zod instance (two instances broke the product
  typecheck).
- The pnpm catalog pins `zod` to exactly **`4.4.3`**. A dedupe moved it to
  4.6.5, which emits a `starts_with` JSON-Schema format that the Assistant's
  ajv validator rejects. A later zod upgrade must teach that validator the
  new formats first.
- The convention helpers take the platform `tenants`/`users` tables **as
  arguments**, so `@omnitech/database` never imports `platform-storage`.
- `platform-storage`'s `tenantTransaction` is rebuilt on the moved pool, and
  existing repositories don't change.

**Rule update** (edit `.rulesync/rules/packages.md`, then regenerate the
outputs):

> `database` owns PostgreSQL connectivity, tenant-scoped transactions and
> migration execution; domain packages own their schemas and repositories.

## Drizzle

- **Version:** `drizzle-orm` and `drizzle-kit` both **pinned exactly** to
  `1.0.0-rc.4`, the newest Drizzle 1.0 release at implementation time
  (`1.0.0-beta.22` when this spec was first written). `pull --init` exists
  only in 1.0.
- **Config:**
  - `dialect: "postgresql"`, with the platform schema and the interview
    `legacy.ts` and `schema.ts` files
  - `out: "./drizzle"`
  - `schemaFilter: ["platform", "interview", "practice"]`, which keeps the
    Assistant's `assistant` schema out
- **Baseline:**
  1. Run `drizzle-kit pull --init` against a database migrated by the legacy
     runner. It records the existing tables as already applied.
  2. Move the result into the package-owned schema files.
  3. Run `drizzle-kit generate`, which must report **no changes**.
- **Migrations** (Drizzle 1.0 folder-per-migration names, recorded by name in
  `drizzle.__drizzle_migrations`):
  - `20261002222255_thick_doctor_octopus`: the `pull --init` baseline
  - `20261002223427_domain_schema` (generated)
  - `20261002223434_force_rls` (custom): explicit `ENABLE` and `FORCE` for
    each new table
- **Run order:** legacy SQL as today, then `runDrizzleMigrations()`.
  `platform-storage`'s `migrate.ts` (used by `pnpm dev` and `db:migrate`) runs
  both.

## Tables

**Conventions.** Every tenant-owned table gets `tenantColumns()`:
- `id uuid` primary key, `tenant_id` (FK → `platform.tenants`, cascade on
  delete)
- `created_by` (FK → `platform.users`), `created_at`, `updated_at`
- `UNIQUE (tenant_id, id)`, plus **composite foreign keys**
  `(tenant_id, x_id) → parent (tenant_id, id)` for every tenant-owned
  reference
- one policy whose `USING` and `WITH CHECK` are both
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`

**`interview` schema**

| Table | Columns | Constraints |
|---|---|---|
| `companies` | `name`, `domain?`, `notes?`, `research?` | partial unique `(tenant_id, domain)` where `domain` is set |
| `people` | `full_name`, `title?`, `company_id?`, `linkedin_url?`, `linked_user_id?` → `platform.users`, `notes?` | |
| `member_people` | `user_id`, `person_id` | PK `(tenant_id, user_id)`; FK `(tenant_id, user_id)` → `platform.tenant_memberships`; `UNIQUE (tenant_id, person_id)` |
| `candidacies` | `company_id`, `candidate_person_id`, `title`, `status`, `source?`, `posting_url?`, `notes?`, `closed_at?` | |
| `interviews` | `candidacy_id`, `ordinal`, `kind`, `label`, `scheduled_at?`, `duration_minutes?`, `format?`, `status` | `UNIQUE (candidacy_id, ordinal)`; `duration_minutes` between 5 and 480 |
| `interview_participants` | `interview_id`, `person_id`, `role`, `role_label?` | `UNIQUE (interview_id, person_id, role)`; `role = 'other'` requires `role_label` |
| `briefing_links` | `briefing_id` (the pack's existing artifact id), `candidacy_id?`, `interview_id?` | `UNIQUE (tenant_id, briefing_id)`; at least one link set |

**Enums:**

| Enum | Values |
|---|---|
| `candidacy_status` | `exploring`, `applied`, `interviewing`, `offer`, `accepted`, `declined`, `rejected`, `withdrawn`, `on_hold` |
| `candidacy_source` | `recruiter_outreach`, `referral`, `applied`, `inbound` |
| `interview_kind` | `recruiter_screen`, `hiring_manager`, `technical`, `system_design`, `take_home`, `panel`, `final`, `other` |
| `interview_format` | `video`, `phone`, `onsite` |
| `interview_status` | `scheduled`, `completed`, `cancelled`, `no_show` |
| `participant_role` | `candidate`, `interviewer`, `recruiter`, `hiring_manager`, `coordinator`, `observer`, `other` |

Future-proofing:
- `interview_kind` and `participant_role` are extensible: `other` plus a
  required label.
- `candidacies` has no job column yet, and `interviews` have no stage column.
  Either can be added as a nullable foreign key later without moving any data.

**`practice` schema**

| Table | Columns | Notes |
|---|---|---|
| `exercises` | `id`, `tenant_id?`, `slug`, `title`, `prompt`, `prompt_key` (normalized prompt, used for matching), `kind`, `difficulty?`, `tags text[]`, `source_kind`, `source_url?`, `created_by?`, timestamps | `tenant_id` null = shared catalog, set = private. `UNIQUE (coalesce(tenant_id::text, ''), slug)`; index on `(tenant_id, prompt_key)` |
| `exercise_attempts` | `tenantColumns()`, `user_id`, `exercise_id` → `exercises.id`, `language`, `draft_id` (the Workspace draft's existing artifact id) | `UNIQUE (tenant_id, user_id, draft_id)`; private to its user |

`exercise_kind` (`algorithm | data_structure | backend | frontend | react | sql | testing | other`),
`exercise_difficulty` (`easy | medium | hard`),
`exercise_source` (`original | generated | user_submitted`).

**`practice` row-level security:**
- `exercises`:
  - **read** where `tenant_id IS NULL OR tenant_id = app.tenant_id`
  - **write** only with `WITH CHECK tenant_id = app.tenant_id`, so users
    can't write shared rows. Shared rows are seeded by a maintainer migration.
- `exercise_attempts`: `tenant_id = app.tenant_id AND user_id = app.actor_id`.

**The one deliberate exception:** `exercise_attempts.exercise_id` is a plain
foreign key, because a shared exercise has no tenant. Read access still goes
through the exercise's own policy.

`draft_id` and `briefing_id` refer to existing per-actor drafts by id, with no
database foreign key: those tables use a different legacy key and stay
untouched. Repositories verify that the draft exists when creating a link.

## `withTenant()`

```ts
export interface TenantContext { tenantId: string; actorId: string }
export type TenantDatabase<R extends AnyRelations = EmptyRelations> =
  PgAsyncTransaction<NodePgQueryResultHKT, R>;
export function withTenant<T, R extends AnyRelations = EmptyRelations>(
  context: TenantContext,
  work: (db: TenantDatabase<R>) => Promise<T>,
  options?: {
    relations?: R;                     // typed relational queries
    schema?: Record<string, unknown>;
    database?: PlatformDatabase;       // defaults to getPlatformDatabase()
  },
): Promise<T>;
```

What it does:
1. **Role guard**, once per `PlatformDatabase`: if the connected role is a
   superuser or has `BYPASSRLS`, it throws, because such a role skips every
   policy even under `FORCE`.
2. Checks out a pooled client and opens **Drizzle's own transaction** on it.
3. `set_config('app.tenant_id', …, true)` and
   `set_config('app.actor_id', …, true)`. Both are transaction-local, so a
   pooled connection can't carry them into the next request.
4. `work(tx)`. A nested `db.transaction()` inside `work` becomes a
   **savepoint**, so it can neither commit the outer unit of work nor drop
   the tenant context.
5. Commit, or roll back on any error, then release the client.

**There is no module-level Drizzle instance and no exported pool.**
`TenantDatabase` exists only as `work`'s argument.

**Prerequisite for part 2:** the application must connect as a
**NOSUPERUSER NOBYPASSRLS** role. `compose.yaml`'s `POSTGRES_USER` is the
cluster's bootstrap superuser, so a fresh compose database needs a separate
application role before part 2 routes traffic through `withTenant`; until
then the role guard fails loudly instead of silently skipping isolation.

## Security tests

These run against the disposable fixture after the full migration run, with
two tenants (A and B). They live in
`products/interview/src/backend/db/security.test.ts` (case 10 in
`packages/platform-storage/src/migrate.test.ts`). They are driven by the
schema and the live catalog, so new tables are covered automatically:
`domainTables` is derived from the schema module's RLS tables.

| # | Case | Expect |
|---|---|---|
| 1 | A selects | only A's rows (plus shared exercises) |
| 2 | A inserts with `tenant_id = B` | rejected |
| 3 | A updates or deletes B's rows | 0 rows affected |
| 4 | A references B's parent | rejected (composite FK) |
| 5 | no tenant context | sees no tenant rows; writes are rejected |
| 6 | same pooled connection, A then B | A's context is gone |
| 7 | table owner | forced row-level security still applies |
| 8 | A writes a shared exercise | rejected |
| 9 | A's other member reads an attempt | not visible (per-user privacy) |
| 10 | migrate on a legacy-migrated database, then migrate again | the three named migrations, schema `practice` and all 9 new tables; the second run is a no-op |
| 11 | schema walk | every tenant-owned reference uses the two-column composite key (at least one checked) |
| 12 | live catalog | every declared table has `ENABLE` and `FORCE`; every policy except `exercises_read` has `WITH CHECK` = `USING` |

## Acceptance criteria

- [ ] `@omnitech/database` provides `withTenant`, the conventions and
      `migrate`. No tenant-scoped handle is exported.
- [ ] Drizzle `1.0.0-rc.4` is pinned exactly, and the baseline produces no
      diff.
- [ ] `domain_schema` and `force_rls` apply to a legacy-migrated database and to a fresh one,
      with the same result.
- [ ] Security tests 1–12 pass.
- [ ] Existing behaviour is unchanged, and `pnpm verify` passes.
- [ ] The package rule is updated and the outputs regenerated.

## Rollback

The new tables are empty until parts 2 and 3. Dropping them, the new enums,
the `practice` schema and the Drizzle journal returns the database to its
current state. Legacy
tables and migrations are never modified.
