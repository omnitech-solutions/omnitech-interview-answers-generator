# Drizzle data-access audit

Read-only discovery. Method: TypeScript compiler AST scan (tagged `sql` templates, `.execute(`, `.query("...")`, builder chains ending in `.from/.values/.set`), grep only as cross-check. Scripts and raw output: `<scratchpad>/drz/`. Rows below the `live-session` heading are files T08 is editing: sequence any cleanup after T08.

## Verdict

**Not consistent.** The Drizzle query builder is used in exactly one production file (`products/interview/src/backend/documents/repository.ts`, 42 builder chains). Everything else is raw SQL, in two shapes: full statements through `tx.execute(sql\`...\`)` (101) and raw `pg` strings through the `DatabaseClient` that `PlatformDatabase.transaction/tenantTransaction/query` hand out (199). Schema coverage and migration hygiene are good (section 3). No injection defect found (section 4).

## 1. Inventory (production only; tests and fixtures separate)

| Class | Count | Where |
|---|---|---|
| A builder | 42 chains | `documents/repository.ts` only |
| B `sql` fragment in builder / helper | 15 | live-session 13, documents/repository 2 |
| C full statement via Drizzle (`execute`, or `rowsOf/firstRow` over `execute`) | 101 (51 execute, 50 helper) | live-session 75, documents (`api.ts` 13, `context.ts` 3, `repository.ts` 2) 18, platform-storage 6, database 2 |
| D raw `pg` `client.query("...")` | 199 | presentation repos 44, platform-storage 42, interview workspace/briefing/briefs/plan/rehearsal/host/backend 71, live-session 33, database 9 |
| E other | ~16 `set_config` (counted inside C/D), 5 advisory locks, 1 `pg_constraint` catalog query | see section 2 |

Excluded from B: ~300 `sql` uses inside `schema/*.ts`, `db/*.ts`, `conventions.ts`: they are DDL declarations (policies, defaults, checks), correct use.

Per file (D, raw `pg`): `presentation/src/repositories/index.ts` 44; `assistant/workspace.ts` 31 (+`adapter.ts` 1); `session-purge.ts` 19; `briefing/repository.ts` 17; `agent-job-repository.ts` 12; `agent-job-worker-repository.ts` 11; `plan/repository.ts` 8; `session-claim.ts` 7; `document-artifact-repository.ts` 7; `platform-repository.ts` 7; `rehearsal/api.ts` 6; `bootstrap.ts` 5; `briefs/api.ts` 4; `connection.ts` 6; `migrate.ts` 2; others 1-3.
Per file (C): `fenced-writes.ts` 11, `ingest.ts` 9, `repository.ts` 12, `owner-input.ts` 7, `documents/api.ts` 13, `companion-capability.ts` 5, `session-reads.ts` 7, `session-pages/choices/standing/record/context/jobs/drafts/screenshot-loader` ~16 combined, `status-transition.ts` 2, `capture-request.ts` 3, `owner-capture.ts` 3, `document-artifact-repository.ts` 6.

Raw `pg` import exists in exactly one production file (`packages/database/src/connection.ts`) and one fixture (`assistant/workspace-fixture.ts`). Raw access reaches product code through `PlatformDatabase` (`index.ts` exports `createPlatformDatabase`, `DatabaseClient`, `enterTenant`).

**Tests/fixtures that bypass Drizzle** (separate): 555 raw `query()` and 17 `sql` statements across tests; heaviest `db/live-session-security.test.ts` 147, `with-tenant.test.ts` 21, `session-purge.test.ts` 19, `documents/api.test.ts` 17, `claim-fenced.test.ts` 17, `ingest.test.ts` 17, `repository.test.ts` 16, `document-artifact-repository.test.ts` 16, `db/security.test.ts` 14, `routes.test.ts` 14, `migrate-upgrade.test.ts` 13. Non-test files that act as fixtures and live in `src`: `live-session-fixture.ts`, `processor-fixture.ts`, `replay-evidence-fixture.ts`, `hardening/world.ts`, `assistant/workspace-fixture.ts`, `presentation/integration/repository.ts`, `database/src/test-support/*`. Keep raw in these (they act as the owner/superuser, set up GRANTs and roles).

## 2. Decision per C/D/E group

Legend: **MIG** migrate to builder; **FRAG** keep as Drizzle `sql` statement or fragment; **RAW** must stay raw.

| Group | Decision and builder constructs | Tenant context | ADR cover |
|---|---|---|---|
| `database/connection.ts` pool, BEGIN/COMMIT/ROLLBACK, `enterTenant` set_config | **RAW** (owns connectivity; Drizzle `transaction()` already does BEGIN/COMMIT inside `withTenant`) | is the context setter | ADR-0003/0005 d4 sanctioned |
| `database/migrate.ts` vendor `assistantMigrations` SQL files + `runWorkerPolicies` DO block | **RAW** (executes opaque vendor SQL; DDL loop over `pg_class`) | n/a | Partly: ADR-0005 d1 names `assistant`, d6 names `app.run_worker`; the second migration mechanism itself is not stated (finding F3) |
| `with-tenant.ts` set_config via `tx.execute(sql)`; `pg_roles` role check | **FRAG** / **RAW** (role check runs before a handle exists) | is withTenant | ADR-0005 d4 |
| platform-storage `agent-job-worker-repository` (11): claim sweep CTE, `FOR UPDATE SKIP LOCKED` candidate + UPDATE...FROM, event-sequence CTE `WITH job AS (UPDATE ... RETURNING), appended AS (INSERT ...)` | simple `get/renew/transition/complete/setSession/insertEvent`: **MIG** (`update().set().where(and(eq,inArray)).returning()`, `sql\`now() + ${ms} * interval '1 millisecond'\``). Claim and append-event CTEs: **FRAG** (`tx.execute(sql\`WITH ...\`)`): one statement allocates the event sequence atomically; data-modifying CTEs in the builder are unproven here (**inferred**, needs a spike) | worker role `app.agent_worker`, no tenant by design | ADR-0005 d6, ADR-0012 (owner file pinned by boundary test) |
| `agent-job-repository` (12): create `ON CONFLICT (id) DO NOTHING RETURNING`, get, cancel, resume, payload insert/delete/read | **MIG** (`onConflictDoNothing().returning()`, `update().set()`, `select().from().where()`); `set_config('app.session_dispatch'|'app.agent_payload_reference')` stay `tx.execute(sql\`select set_config\`)` | tenantTransaction or `enterTenant`; payload read via reference policy | ADR-0005 d6, ADR-0012 |
| `document-artifact-repository` (7 D + 6 C): artifact + payload inserts, provisioner set_config, bytea select | **MIG** (inserts/select with join); set_config **FRAG** | enterTenant / provisioner setting | ADR-0010/0009 (inferred) |
| `platform-repository` (7), `bootstrap` (5) | **MIG** (`onConflictDoUpdate`, `returning`, `innerJoin`). Context lookup `users CROSS JOIN tenants` keeps `crossJoin` or **FRAG** | users/tenants/preferences are not tenant-owned (no RLS); membership read after `enterTenant` | ADR-0005 |
| presentation `repositories/index.ts` (44) + `integration/repository.ts` | **MIG** all (plain CRUD; `${table}` ternary becomes two table objects; `ANY` becomes `inArray`; theme `count(...)::text` becomes `sql<number>` fragment). Share lookup: `set_config('app.share_token_hash')` **FRAG** | tenantTransaction/enterTenant; `getShared` is the named share policy | ADR-0005 d6 |
| interview workspace/briefing/briefs/plan/rehearsal/host/adapter (71) incl. `FOR UPDATE`, `pg_advisory_xact_lock(hashtextextended(...))` x5, `DISTINCT ON`, `to_tsvector`/FTS, `$n=ANY(audience)`, jsonb `->>` | **MIG** CRUD (`onConflict`, `.for('update')`, `inArray`, `arrayContains`, `selectDistinctOn`); advisory locks and FTS stay **FRAG** (`tx.execute(sql\`select pg_advisory_xact_lock(...)\`)`, `sql\`to_tsvector(...) @@ ...\``); jsonb operators **FRAG** inside builder. Retire the `WorkspaceTransaction.query(text, values)` seam and `boundQuery` (`session-drafts.ts:67-85`) | `tenantTransaction` + `enterTenant` + `set_config('app.product_id')` in `workspace.ts:258-262`; not `withTenant` | ADR-0005 d4 permits raw client via tenantTransaction; AGENTS rule 5 says `withTenant` (conflict, F2) |
| `interview-backend.ts` run worker (`app.run_worker`), `isMember`, `rowsOf` shim | **FRAG** for the setting; `isMember` **MIG** (`tenant_id::text=$1` casts the column and defeats the key index: use `eq`) | run_worker policy / tenantTransaction | ADR-0005 d6 |
| live-session `session-claim.ts` (7): claim `UPDATE ... FROM (SELECT ... FROM active_session_claims ... FOR UPDATE SKIP LOCKED)`; lease renew/release | `renew/release/sweep` selects **MIG**. Claim UPDATE: **FRAG** statement unless `active_session_claims` view is declared with `pgView().existing()` (the view is hand-written in migration `20261003051000`, not declared, and omits `credential_hash` on purpose) | `app.session_worker` | ADR-0012 Claim, boundary test pins owner file |
| `credential-lookup.ts`, `ingest.ts:178`, `routes.ts:210/220` | **MIG** the selects; `session_credential_hash` set_config **FRAG**. `routes.ts:210` reads `platform.tenants` (not tenant-owned) in a context-less `transaction` | credential policy; install check in tenant | ADR-0012, ADR-0004 d4 |
| `session-purge.ts` (19 + 3 fragments): DELETE/UPDATE chains, `ANY($n::uuid[])`, `pg_constraint` coverage check, final counts | deletes/updates/counts **MIG** (`delete().where(inArray()).returning()`, `count()`); `pg_constraint` query **FRAG** (`db.execute`, catalog, no table); `set_config('app.session_purge'|'app.product_id')` **FRAG** | actor scope + purge setting | ADR-0012 Retention and purge |
| live-session C (75): fenced writes, ingest, repository, owner input/capture, status transition, reads, pages, choices | Simple INSERT/UPDATE/SELECT: **MIG**. Keep **FRAG**: `UPDATE ... SET x = CASE ... END`, `COALESCE(col, now())` (use `sql` fragments inside `.set()`), `EXISTS` subselects, `lockSession` (`.for('update')`), keyset `(at,id) <` paging, `sql.join` IN lists become `inArray`. No fenced write needs a particular statement shape beyond "lock the session row in the same transaction, then check fence, lease and revision" (`fenced-writes.ts` header, ADR-0012): builder preserves that | `withTenant` via `inOwnerScope` (`scope.ts`) | ADR-0012 |
| documents `api.ts`/`context.ts` (18 C) | **MIG** (the same file family already uses the builder; tables in `db/schema.ts`, `db/documents.ts`) | `withTenant` | ADR-0009 |

**withTenant findings**
- F1 (medium): `tenantTransaction`/`enterTenant` never run `assertRowLevelSecurityApplies` (the superuser / `BYPASSRLS` refusal that only `withTenant` performs, `with-tenant.ts:56-80`). 199 raw sites run without that guard, so isolation silently disappears if the app role is mis-provisioned. Fix is small: call the check from `transaction`/`tenantTransaction` in `connection.ts`.
- F2 (low, doc conflict): AGENTS.md rule 5 and invariant INV-0002 say tenant-scoped Drizzle goes through `withTenant()`; ADR-0005 d4 (status **Proposed**, not Accepted) sanctions raw `tenantTransaction`. INV-0002's recorded `last_result: fail` (2026-10-02) predates routing those files through `enterTenant`; the boundary test now passes. Refresh or ratify.
- No site touching a tenant-owned table without tenant context. Context-less reads hit only `platform.users`, `tenants`, `user_preferences`, `connected_accounts`, `login_identities`, `auth_sessions` (no RLS by design; 9 platform/ai catalog tables are not forced, all non-tenant-owned).
- F4 (low): `scripts/tenant-context-boundary.test.ts` pins one owner file for six settings. `app.share_token_hash` (presentation), `app.agent_payload_reference` and `app.document_catalog_provisioner` (two files: platform-storage and `documents/repository.ts`) are not pinned although ADR-0005 d6 says such use is policed.

## 3. Schema coverage and migrations

- **Coverage complete.** AST + `getTableConfig` found 67 declared tables (`platform` 11, `ai` 10, `interview` 30, `practice` 2, `presentation` 14 across the five `pgSchema`s) and the migrated DB has the same 67 (compared names and column sets). No table is raw-only.
- Undeclared objects: view `interview.active_session_claims` (hand-written, queried only by raw SQL in `session-claim.ts`; declare `pgView(...).existing()` if the claim moves to the builder); vendor schemas `assistant.*` (14 tables) and `pgboss.*` (12) with no Drizzle definition, not queried by product SQL (grep found none), owned by `@omnitech-assistant/storage-postgres` and pg-boss.
- **Drift:** the isolated DB (54330) is one migration behind (latest applied `20261004043058_capture_request`, 23 rows vs 24 folders), so `interview.companion_capabilities` lacks `capture_request_support` and `screen_selection`. That is pending, not drift; all other 66 tables match column-for-column. `drizzle-kit check` (reads snapshots only): "Everything's fine".
- **Single stream:** all 24 migrations are folders with `migration.sql` + `snapshot.json` in `packages/database/drizzle` (Drizzle v1 format, no `meta/_journal.json`; the folder name is the journal). `drizzle.config.ts` lists the six schema files and `schemaFilter` excludes `assistant`/`pgboss`.
- **Other mechanisms (F3):** (1) vendor `assistantMigrations` SQL files + `runWorkerPolicies` applied by `migrate.ts` before the Drizzle migrator; (2) pg-boss creates `pgboss` at runtime; (3) `docker/postgres/app-role.sql` creates the app role (bootstrap, acceptable); (4) `packages/platform-storage/src/bootstrap.ts` seeds rows with raw SQL (dev only); (5) `active-session-contracts` `schema:generate` is JSON-schema generation, unrelated. No hand-applied DDL elsewhere in `scripts/`, `docker/`, or product folders.

## 4. Type safety

| Finding | Where | Severity |
|---|---|---|
| Injection: no non-parameterised interpolation of caller data found. All `${...}` in raw strings are module constants or closed ternaries: `${where}`/`${scoped}` (`"tenant_id=$1 AND actor_id=$2 AND product_id=$3"`), `${table}` (two literals, `presentation/.../index.ts:693-705`), `FOR UPDATE` toggle (`workspace.ts:337`), `CLAIM_COLUMNS` | 5 files | none (stringly typed, LOW) |
| `boundQuery` turns any caller text into `sql.raw` parts (values are `sql.param`): safe today only because every caller passes a static literal; the `WorkspaceTransaction.query(text,...)` type accepts any string | `session-drafts.ts:67-85` | medium latent |
| Rows asserted, not inferred: `result.rows as unknown as Row[]` | `scope.ts:36`, `session-drafts.ts:82`; plus `client.query<Row>` generics (unchecked) and `SELECT *` with hand mapping (`mapJob`, workspace `row as`) at ~150 sites | medium |
| Quoted-literal interpolation in schema CHECKs from `as const` tuples | `db/live-session.ts:88,319,323` | none (static) |
| `tenant_id::text=$1` column cast | `interview-backend.ts:169` | low (perf) |
| `sql.join` IN-lists instead of `inArray` | `owner-input.ts:293`, `session-choices.ts:74`, `session-purge.ts:145` | low |

## 5. Plan (changed lines = adds + deletes, rough)

| WP | Scope | Owner files | Est. | Proof tests (DB-backed) |
|---|---|---|---|---|
| 0 | Documented exception: one Proposed ADR (amends ADR-0005) naming sanctioned raw: connectivity, vendor migrations, worker/credential/purge settings, catalog introspection; plus a boundary test that fails on any new `.query("` or `pg` import outside an allowlist, and pin the 3 unpinned settings (F4); add RLS role check to raw transactions (F1) | `bionic/adrs`, `scripts/tenant-context-boundary.test.ts`, `database/connection.ts` | ~200 | `connection.test.ts`, `with-tenant.test.ts`, boundary test |
| 1 | documents `api.ts`, `context.ts`, `repository.ts` C to builder | `products/interview/.../documents/*` | ~350 | `documents/api.test.ts`, `context.test.ts`, `repository.test.ts`, `db/documents-security.test.ts` |
| 2 | platform-storage D+C (`platform-repository`, `bootstrap`, `document-artifact-repository`, `agent-job-repository`, simple worker methods); new `database` export for a context-less Drizzle transaction used by sanctioned worker and lookup paths | `packages/platform-storage`, `packages/database` | ~900 | `agent-job-private.test.ts`, `agent-job-repository.test.ts`, `platform-repository.test.ts`, `membership-context.test.ts`, `document-artifact-repository.test.ts`, `agent-worker/main.test.ts` (leasing, private marker, idempotent create) |
| 3 | presentation repositories | `products/presentation` | ~1000 | `presentation/api.test.ts`, `repositories/shared.test.ts` (share lookup RLS) |
| 4 | interview workspace/briefing/plan/briefs/rehearsal/host; delete `WorkspaceTransaction` raw seam and `boundQuery` | `products/interview/.../assistant,briefing,plan,briefs,rehearsal,studio` | ~1500 | `workspace.test.ts`, `combined.test.ts`, `effects.test.ts`, `briefing/api.test.ts`, `plan/api.test.ts`, `session-hints.test.ts`, `db/security.test.ts` |
| 5 | live-session C (75) + D (33): after T08 only | `.../live-session/*` | ~1600 | `db/live-session-security.test.ts` (RLS, 147 raw probes), `claim-fenced.test.ts`, `processor-fencing.test.ts` (fencing, leasing), `session-purge.test.ts`, `hardening/retention.test.ts` (purge), `ingest.test.ts`, `ingest-hardening.test.ts` (idempotency), `no-content-canary.test.ts` |

Estimated total **~5,500 changed lines**, far above the 1,000-line scope checkpoint of AGENTS.md rule 1. **Recommendation: surface the checkpoint to the user before any migration.** Minimum useful choice is WP0 (~200 lines) alone, which makes the exception explicit and stops growth. Next best value per line: WP1 (same file family already on the builder, no new `database` API). WP2 needs a new `database` export (context-less Drizzle transaction), which is a public-surface addition: decide it with the user.

Documented exceptions that cannot disappear even after full migration (keep as `tx.execute(sql\`...\`)` in one place each): `set_config` for the six cross-tenant settings, advisory locks, FTS, `pg_constraint` coverage query, the two data-modifying-CTE statements (claim, append-event) unless a spike proves the builder keeps them single-statement, vendor migrations, `pg_roles` check. Minimal ADR text: "Raw SQL is allowed only in `packages/database` (connection, vendor migrations, role check) and as `sql` statements through a Drizzle handle for named cross-tenant settings, advisory locks, catalog introspection and single-statement CTEs; every other query uses the query builder."

Open: Drizzle rc.4 support for `UPDATE ... FROM (subquery with .for('update',{skipLocked:true}))` and `$with` over `update().returning()` was not verified (**inferred**); spike before WP2/WP5. Nothing was run that writes; DB queries were schema reads only.

## Outcome (scope "Safety + docs now", 2026-10-04)

- F1 fixed: one `assertRowLevelSecurityApplies` in `packages/database/src/connection.ts` now guards `withTenant`, `tenantTransaction` and `enterTenant`, with one fixed refusal message. Tests: `role-check.test.ts` (scripted pool), `connection.test.ts` (disposable PostgreSQL: superuser and BYPASSRLS refused on all three paths, application role admitted).
- F4 fixed: `scripts/tenant-context-boundary.test.ts` pins `app.share_token_hash`, `app.agent_payload_reference` and `app.document_catalog_provisioner` (two owners).
- WP0 guard: `scripts/raw-sql-guard.test.ts` (AST scan, typed allowlist seeded from today's measured counts).
- F2/F3 recorded in the Proposed ADR-0023 (amends ADR-0005). AGENTS.md rule 5 and INV-0002 change only when it is accepted.
- Not done: `tenant_id::text=$1` in `interview-backend.ts` (needs a DB-backed proof); `boundQuery` in `session-drafts.ts` (live-session is under edit). No behaviour migration to the builder.

### Structural guard (2026-10-04)

The role check moved from three call paths to the database handle, so "app code runs as a superuser or BYPASSRLS role" cannot recur silently.

- `createPlatformDatabase(url, { allowRlsBypass: true })` is the only opt-in. Without it every entry of the handle (`query`, `transaction`, `tenantTransaction`, `withTenant`) awaits one memoised role check (one lookup per handle, fixed message, fail closed on an unrecognised result, failed lookup retried). `enterTenant` still checks each client it receives. The per-path calls were removed. Migrations run as the application role in production and need no opt-in; `db:migrate` and its test now use a NOSUPERUSER role.
- Boot fail-fast: `verifyDatabaseRole(database)` runs at start in `apps/web/instrumentation-node.ts` and `apps/agent-worker/src/main.ts`, so a superuser `DATABASE_URL` stops the process before the first request. A database that is unreachable at boot also stops the process (the lookup error propagates).
- `scripts/rls-role-guard.test.ts` (TypeScript AST) allowlists every `allowRlsBypass` use with a reason, fails when an owner URL reaches `createPlatformDatabase`, a `DATABASE_URL` stub or env, or `runQueueConnectionString` outside four refusal proofs, and fails on stale entries. The fixture keeps `owner` opted in; the refusal message names `memberUrl` and `grantApplicationRole`.
- Proof: `role-check.test.ts` (scripted pool, each entry) and `connection.test.ts` (disposable PostgreSQL: superuser and BYPASSRLS refused on every entry, the application role served everywhere). `interview-backend.test.ts` now gives the run queue `memberUrl`.

