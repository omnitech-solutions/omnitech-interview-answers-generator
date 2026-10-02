# 001 — Foundation

Sub-project 1 of [the interview domain architecture](../architecture/interview-domain.md).

**Primary invariant:** schema, tenancy, row-level security and migration
behaviour are correct before any feature builds on them.

**Out of scope:** this spec ships no user-facing feature. The Interviews view,
the backfill, suggestion review, artifact ingest, debriefs and preparation
belong to sub-projects 2–5.

## Existing state

- **Data access** is `pg` with hand-written SQL in per-package repositories.
  There is no ORM.
- **`@omnitech/platform-storage`** owns the pool (`createPlatformDatabase`,
  `getPlatformDatabase`), `transaction()`, and
  `tenantTransaction(tenantId, fn)`, which sets
  `set_config('app.tenant_id', …, true)` for the transaction. Product
  repositories also set `app.actor_id` and `app.product_id`.
- **Migrations:** `packages/platform-storage/src/migrate.ts` runs a hard-coded
  list on every start, in this order:
  1. `0001`–`0003` (platform)
  2. the Assistant's `assistantMigrations`
  3. `0004`–`0011` (interview product)

  Every file is idempotent and re-run each time. Nothing records which have
  been applied.
- **Platform tables** (`users`, `tenants`, `tenant_memberships`,
  `product_installations`, `artifacts`, `audit_events`, …) use **tenant-only**
  row-level security:
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`.
- `tenant_memberships.role` is already `platform.tenant_role`
  (`owner | admin | member`), `NOT NULL` with no default. The bootstrap
  inserts `owner` explicitly.
- **Interview tables** are private per actor, keyed on
  `(tenant_id, actor_id, product_id, id)` with forced row-level security.
- `platform.artifacts` exists but nothing in the code uses it yet.
- **Tests** use a disposable Postgres fixture
  (`products/interview/src/backend/assistant/workspace-fixture.ts`) that
  applies SQL files directly. It needs `LC_ALL` set on macOS.
- **Package rule** (`.rulesync/rules/packages.md`): *"`platform-storage`
  owns PostgreSQL access, tenant transactions, migrations…"*.

## Target state

1. A new **`@omnitech/database`** package owns connectivity, tenant-scoped
   transactions, and running both schema and data migrations.
2. **Drizzle** defines schemas in the owning packages, with one database-wide
   migration stream baselined from the current database.
3. The **Network and Hiring schema** exists, empty and secured: tenant-owned
   tables, forced row-level security, composite tenant foreign keys.
4. **`withTenant()`** is the only way to get a tenant-scoped Drizzle handle.
5. **Data-migration infrastructure** exists (a per-tenant ledger, a provenance
   table, and a suggestions table), so sub-project 2's backfill is just one
   frozen migration file.
6. A security test suite proves the isolation properties.

## Package changes

```
packages/database/                      NEW  @omnitech/database
  drizzle.config.ts                     one config, both schema files
  drizzle/                              the migration stream (SQL + snapshots + journal)
  data-migrations/                      frozen per-tenant data migrations (none yet)
  src/
    pool.ts                             the pool (moved from platform-storage/database.ts)
    with-tenant.ts                      withTenant(), the only tenant-scoped entry point
    conventions.ts                      tenantColumns, tenantPolicy, tenantReference, timestamps
    migrate.ts                          legacy SQL → Drizzle migrate() → data migrations
    data-migrations.ts                  runner: per-tenant ledger, checksums
    index.ts                            public entrypoint
  test/
    fixture.ts                          disposable Postgres, shared (moved from the interview product)
    security.test.ts                    the isolation suite

packages/platform-storage/
  src/schema/platform.ts                NEW  pgSchema("platform"), pulled baseline + new columns
  src/database.ts                       re-exports from @omnitech/database (compatibility); later removed
  migrations/0001…0011                  unchanged, still run first, still idempotent

products/interview/
  src/backend/db/schema.ts              NEW  pgSchema("interview"): pulled baseline + Network/Hiring tables
  src/backend/db/relations.ts           NEW  defineRelations(...)
```

**Dependency direction:**
- `@omnitech/database` depends on `pg` and `drizzle-orm`.
- `platform-storage` and the interview product depend on `@omnitech/database`.
- `drizzle.config.ts` names both schema files **by path**. That's tooling
  configuration, not a runtime import, so the dependency direction holds.

**Rule change** (edit `.rulesync/rules/packages.md`, then regenerate the
compatibility outputs):

> `database` owns PostgreSQL connectivity, tenant-scoped transactions and
> migration execution; domain packages (`platform-storage`, `products/*`)
> own their schemas and repositories.

## Drizzle setup

- **Version:** the newest Drizzle 1.0 release at implementation time
  (`drizzle-orm` and `drizzle-kit` `1.0.0-beta.22` when this was written),
  **pinned exactly** with no ranges. It's needed for `pull --init` and
  `defineRelations`, both of which exist only in 1.0. Upgrades are deliberate,
  and the security suite must pass before one is accepted.
- **Config:**
  - `dialect: "postgresql"`
  - `schema`: the two schema files
  - `out: "./drizzle"`
  - `schemaFilter: ["platform", "interview"]`, which excludes `assistant`,
    `ai`, `presentation` and `public`
  - `migrations: { table: "__drizzle_migrations", schema: "drizzle" }`
- **Baseline:**
  1. `drizzle-kit pull --init` against a database migrated by the legacy
     runner. It introspects `platform` and `interview`, writes the initial
     snapshot and records it as applied, so nothing gets recreated.
  2. Move the generated TypeScript into the two package-owned schema files,
     reviewing names, enums and defaults.
  3. Run `drizzle-kit generate`, which must report **no changes**. That is
     the proof the baseline matches the database.
- **From then on:**
  - schema changes: `drizzle-kit generate --name=<change>`
  - hand-written SQL: `drizzle-kit generate --custom --name=<change>`, for
    forced row-level security, assertions and anything the generator doesn't
    produce
  - applying: `migrate()` at start-up
- **Run order** (`@omnitech/database` `migrate.ts`):
  1. legacy platform SQL `0001`–`0003`
  2. the Assistant's migrations
  3. legacy interview SQL `0004`–`0011`
  4. Drizzle `migrate()`
  5. data migrations

  `pnpm dev` and `db:migrate` call this runner.

## Schema definitions

**Conventions (`conventions.ts`).** These are plain helpers, not a framework. They take the platform `tenants` and `users` tables **as arguments**: `@omnitech/database` must not import `platform-storage`, which itself depends on `@omnitech/database`.

```ts
// Every tenant-owned table: uuid id, tenant, provenance, timestamps.
export const tenantColumns = ({ tenants, users }: PlatformTables) => ({
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),        // null for system-made rows
  creationSource: creationSource("creation_source").notNull(),     // user | data_migration | assistant | import
  ...timestamps(),
});
// USING + WITH CHECK on the transaction's tenant.
export const tenantPolicy = (table: string, tenantId: AnyPgColumn) => pgPolicy(`tenant_${table}`, { … });
// UNIQUE (tenant_id, id) on parents; FOREIGN KEY (tenant_id, x_id) → parent (tenant_id, id) on children.
export const tenantUnique = (t) => unique().on(t.tenantId, t.id);
export const tenantReference = (t, column, parent) => foreignKey({ columns: [t.tenantId, column], foreignColumns: [parent.tenantId, parent.id] });
```

**Enums** (`interview` schema unless noted):

| Enum | Values |
|---|---|
| `platform.creation_source` | `user`, `data_migration`, `assistant`, `import` |
| `candidacy_status` | `exploring`, `applied`, `interviewing`, `offer`, `accepted`, `declined`, `rejected`, `withdrawn`, `on_hold` |
| `candidacy_source` | `recruiter_outreach`, `referral`, `applied`, `inbound` |
| `stage_kind` | `application`, `recruiter_screen`, `hiring_manager`, `technical`, `take_home`, `onsite`, `final`, `references`, `offer`, `other` |
| `stage_status` | `upcoming`, `active`, `passed`, `failed`, `skipped` |
| `interview_format` | `video`, `phone`, `onsite` |
| `interview_status` | `scheduled`, `completed`, `cancelled`, `no_show` |
| `participant_role` | `candidate`, `interviewer`, `recruiter`, `hiring_manager`, `coordinator`, `observer`, `other` |
| `work_mode` | `remote`, `hybrid`, `onsite` |
| `employment_evidence_source` | `candidate_profile`, `artifact` |
| `suggestion_origin` | `migration`, `transcript`, `assistant`, `import` |
| `suggestion_confidence` | `high`, `medium`, `low` |
| `suggestion_status` | `open`, `accepted`, `dismissed` |

**Platform changes** (`platform` schema):

| Table | Change |
|---|---|
| `tenant_memberships` | unchanged. A platform table never references a product table; the product maps members to people (see `member_people`). |
| `artifacts` | **add** `source text NULL`, `mime_type text NULL`, `current_revision integer NULL`, and `UNIQUE (tenant_id, id)`. `artifact_type` holds the kind. |
| `artifact_revisions` | **new.** `tenant_columns`; `artifact_id`; `revision int`; `raw_text text NOT NULL`; `structure jsonb NULL` (for example transcript turns); `parser text NULL` + `parser_version text NULL`; `sha256 text NOT NULL`. `UNIQUE (artifact_id, revision)`, composite FK to `artifacts`. The table is append-only: there's no update policy, and a trigger rejects `UPDATE`. |
| `data_migrations` | **new.** `migration_id text`, `tenant_id uuid`, `checksum text`, `applied_at timestamptz`, `summary jsonb`; `PRIMARY KEY (migration_id, tenant_id)`. It is infrastructure, not tenant domain data: no row-level security policy, written only by the runner. |

**Interview schema, new tables.** Every table has `tenantColumns()`,
`tenantUnique`, `tenantPolicy`, and composite foreign keys for each
tenant-owned reference.

| Table | Columns | Notes |
|---|---|---|
| `people` | `full_name`, `headline?`, `location?`, `primary_email?`, `linkedin_url?`, `linked_user_id?` → `platform.users`, `notes?` | no `is_self` flag; "me" is the member's `member_people` row |
| `member_people` | `user_id`, `person_id` | `PRIMARY KEY (tenant_id, user_id)`; FK `(tenant_id, user_id)` → `platform.tenant_memberships`; composite FK to `people`; `UNIQUE (tenant_id, person_id)`. The canonical "this signed-in member is this Person in this workspace". |
| `companies` | `name`, `search_name` (normalised, for suggestions only), `domain?`, `linkedin_url?`, `industry?`, `notes?`, `research?` | partial unique `(tenant_id, domain) WHERE domain IS NOT NULL`; index on `(tenant_id, search_name)` |
| `employment` | `person_id`, `company_id`, `title`, `team?`, `started_on? date`, `ended_on? date`, `is_current bool` | check: `ended_on >= started_on` |
| `employment_evidence` | `employment_id`, `source_kind`, `profile_id?` + `profile_revision?`, `artifact_revision_id?`, `locator` | check: exactly the pair matching `source_kind` is set |
| `jobs` | `company_id`, `title`, `team?`, `level?`, `location?`, `work_mode?`, `comp_min?`, `comp_max?`, `comp_currency?`, `posting_url?` | check: `comp_max >= comp_min`; `UNIQUE (tenant_id, company_id, id)` |
| `candidacies` | `candidate_person_id`, `company_id`, `job_id?`, `title`, `status`, `source?`, `started_at`, `applied_at?`, `closed_at?`, `notes?` | FK `(tenant_id, company_id, job_id)` → `jobs (tenant_id, company_id, id)` (`MATCH SIMPLE`, so a null `job_id` is allowed). A job always belongs to the candidacy's company, enforced declaratively. |
| `candidacy_stages` | `candidacy_id`, `ordinal int`, `kind`, `label` (required), `status`, `started_at?`, `completed_at?` | `UNIQUE (candidacy_id, ordinal)` |
| `interviews` | `stage_id`, `title`, `scheduled_at?`, `duration_minutes?`, `format?`, `status` | check: `duration_minutes` between 5 and 480 |
| `interview_participants` | `interview_id`, `person_id`, `role`, `role_label?` | `UNIQUE (interview_id, person_id, role)`; check: `role = 'other'` requires `role_label` |
| `domain_suggestions` | `origin`, `kind text`, `proposed_action jsonb`, `source_evidence jsonb`, `source_fingerprint text`, `confidence`, `reasoning text`, `target_candidacy_id?`, `status`, `decided_by?`, `decided_at?` | `UNIQUE (tenant_id, origin, source_fingerprint, kind)`; index on `(tenant_id, target_candidacy_id, status)` |
| `migration_entity_sources` | `migration_id`, `source_type`, `source_id`, `source_locator`, `entity_type`, `entity_id` | `UNIQUE (tenant_id, migration_id, source_type, source_id, source_locator, entity_type)` |

Join tables, debriefs and offers wait for sub-projects 3 and 4. Their shape
is fixed in the architecture document.

## Row-level security conventions

- Every new tenant-owned table has `ENABLE` **and `FORCE`** row-level
  security, with one policy whose `USING` and `WITH CHECK` are both
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`.
- `FORCE ROW LEVEL SECURITY` lives in a reviewed custom migration
  (`0013_force_rls`) that lists every new table **explicitly**, one
  `ENABLE …; FORCE …;` pair per table. It is never generated.
- A missing `app.tenant_id` makes the predicate `NULL`, so a session without
  a tenant context sees nothing and can't write.
- Legacy interview tables keep their per-actor policies unchanged.

## Composite foreign key conventions

- Every tenant-owned parent has `PRIMARY KEY (id)` and `UNIQUE (tenant_id, id)`.
- Every reference from a tenant-owned row is
  `FOREIGN KEY (tenant_id, x_id) REFERENCES parent (tenant_id, id)`.
- References to `platform.users` (`created_by`, `linked_user_id`,
  `decided_by`) are plain foreign keys, because users aren't tenant-owned.
- A unit test walks the Drizzle schema and **fails if any tenant-owned table
  references another tenant-owned table without the composite key**. That
  turns the convention into a check rather than something to remember.

## `withTenant()`

```ts
export interface TenantContext { tenantId: string; actorId: string | null }

export function withTenant<T>(
  context: TenantContext,
  work: (db: TenantDatabase) => Promise<T>,
): Promise<T>;
```

**What it does:**
1. Checks out a pooled client and runs `BEGIN`.
2. Runs `SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)`.
   These settings are **transaction-local**, so a pooled connection can never
   carry them into the next transaction.
3. Calls `work` with `drizzle(client, { schema, relations })`.
4. Runs `COMMIT`, or `ROLLBACK` on any error, then releases the client.

**Invariants:**
- `@omnitech/database` exports **no** module-level Drizzle instance and no
  tenant-scoped handle. `TenantDatabase` exists only as the `work` argument.
- The pool itself isn't exported to product code. Product code gets
  `withTenant` and nothing else.
- Platform-wide operations that legitimately span tenants (the migration
  runner enumerating tenants, the auth lookup of a user's memberships) use an
  internal `withSystem()` that runs no tenant-scoped queries. Its call sites
  are listed in the package and reviewed.
- `tenantTransaction` in `platform-storage` stays as it is for legacy
  repositories, then gets re-implemented on top of the same pool.

## Migration baseline and data-migration infrastructure

- **Baseline:** described under *Drizzle setup*. Acceptance requires that
  `drizzle-kit generate` reports no changes straight after the baseline.
- **Schema migrations in this sub-project:**
  - `0012_domain_schema` (generated): new enums and tables, plus the platform
    column changes
  - `0013_force_rls` (custom): explicit enable and force per new table
  - `0014_artifact_revisions_append_only` (custom): the `UPDATE`-rejecting
    trigger
- **Data-migration runner** (`data-migrations.ts`):
  1. Discovers `data-migrations/NNNN-name.ts` files in order.
  2. Computes each file's checksum.
  3. For **each tenant**, skips it if `(migration_id, tenant_id)` is in the
     ledger. A changed checksum on an applied migration **fails loudly**.
     Otherwise it runs the migration inside `withTenant({ tenantId, actorId: null })`,
     then records it in the ledger in the same transaction.
  4. Tenants created later receive pending migrations on the next run.
- **Data-migration contract:**

  ```ts
  export interface DataMigration {
    id: string;                       // "0001-interview-domain-backfill"
    run(ctx: { db: TenantDatabase; tenantId: string }): Promise<Record<string, number>>; // summary counts
  }
  ```

  Migrations are frozen: they import only `@omnitech/database` and their own
  helpers, never product repositories. A lint rule
  (`noRestrictedImports` for `data-migrations/**`) enforces that.
- This sub-project ships the runner with **no** data migrations. Sub-project
  2 adds `0001-interview-domain-backfill`.

## Security tests (`packages/database/test/security.test.ts`)

These run against the disposable Postgres fixture, after the full migration
run (legacy SQL, then Drizzle, then data migrations). They set up two tenants,
A and B, each with a member. Every case below runs against **each new
tenant-owned table**, driven by the schema, so new tables are covered
automatically.

| # | Case | Expect |
|---|---|---|
| 1 | A `SELECT` | sees only A's rows |
| 2 | A `INSERT` with `tenant_id = B` | rejected (`WITH CHECK`) |
| 3 | A `UPDATE` of B's row | 0 rows affected |
| 4 | A `DELETE` of B's row | 0 rows affected |
| 5 | A row referencing B's parent | rejected (composite FK) |
| 6 | no `app.tenant_id` | `SELECT` returns nothing; `INSERT` rejected |
| 7 | pooled-connection reuse | transaction as A, then the **same** connection as B: A's context is gone, and B sees only B |
| 8 | table owner | forced security applies to the owner role too |
| 9 | `artifact_revisions` `UPDATE` | rejected by the trigger |
| 10 | migration from the existing shape | the database migrated by the legacy runner, plus the Drizzle stream, gives the expected schema; a second run is a no-op |
| 11 | data-migration ledger | applies per tenant; a later tenant receives it; a changed checksum fails |
| 12 | composite-FK convention | the schema walk finds no tenant-owned reference without the composite key |

The disposable fixture moves to `@omnitech/database`'s test helpers, and the
interview product re-imports it. It keeps the macOS `LC_ALL` requirement,
now documented in the fixture.

## Acceptance criteria

- [ ] `@omnitech/database` exists with `withTenant`, the conventions,
      `migrate`, and the data-migration runner. No tenant-scoped handle is
      exported.
- [ ] Drizzle 1.0 is pinned exactly, and the baseline produces **no diff**.
- [ ] `0012`–`0014` apply to a database migrated by the legacy runner and to
      a fresh database, with the same result.
- [ ] `member_people` maps each member to a Person without any platform → product reference.
- [ ] All the new tables exist with forced row-level security, one tenant
      policy each, composite tenant foreign keys, and the listed checks.
- [ ] Security tests 1–12 pass.
- [ ] Existing behaviour is unchanged. `pnpm verify` passes, with the
      existing interview and platform tests running against the new
      migration runner.
- [ ] The `.rulesync` package rule is updated and the outputs regenerated.
- [ ] `pnpm dev` migrates and starts as before.

## Rollout

1. Ship the package, the baseline, and `0012`–`0014`. The new tables are
   empty, and no feature reads them.
2. Sub-project 2 ships the backfill, which creates a Person and a `member_people` row for every membership.
3. Then ship a gated assertion migration, named when it's written, which **raises an exception** unless every `platform.tenant_memberships` row has a matching `interview.member_people` row. From then on, membership creation (bootstrap, auth) must create the Person and mapping in the same transaction.

**Rollback:** before sub-project 2 writes any data, dropping the new tables
and columns and the Drizzle journal returns the database exactly to its
current state. The legacy migrations and tables are untouched throughout.

## Non-goals

- Converting existing hand-written repositories to Drizzle.
- Changing legacy interview tables or their per-actor privacy.
- Debrief, offer, communication and artifact-join tables (sub-projects 3 and 4).
- Any UI, API route or generation change.
