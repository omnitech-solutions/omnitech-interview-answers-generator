# DATA report: PG-SEC-05, PG-DAT-01, DK-SEC-01, DK-DAT-01

## Changes per tracker row

- **DK-SEC-01**: `compose.yaml` publishes `127.0.0.1:54320:5432`. Nothing else relied on the old binding (every URL already says 127.0.0.1; grep of scripts, docs and e2e found none).
- **PG-SEC-05** (owner/runtime split):
  - `docker/postgres/ensure-roles.sql` (new, replaces `app-role.sql`, which is deleted): pure SQL, idempotent. Creates `omnitech_owner` and `omnitech` if absent (passwords only at creation), re-asserts NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB, makes the owner own the database, schemas, tables, free sequences, functions and enum/domain types (hands over only what `omnitech` owned, so a pre-split database upgrades in place), grants the runtime USAGE + SELECT/INSERT/UPDATE/DELETE + sequence USAGE/SELECT, trims `drizzle.*` to read-only for the runtime, and sets default privileges `FOR ROLE omnitech_owner` (tables, sequences, schemas). The runtime keeps CONNECT and CREATE on the database because pg-boss creates its own `pgboss` schema at start; that schema stays runtime-owned and is excluded from the handover.
  - `docker/postgres/init.sh` (new): empty-volume init; creates database `omnitech` then applies the same SQL, so fresh and upgraded databases match. `compose.yaml` mounts both.
  - `packages/database/src/migrate-command.ts`: migrates as `DATABASE_OWNER_URL` when set, else `DATABASE_URL` (single-role setups, the e2e harness and tests are unchanged). `DATABASE_URL` keeps its meaning and the runtime role keeps the name `omnitech`.
  - `scripts/dev.mjs`: `ensureDatabaseRoles()` pipes the SQL into `docker compose exec -T postgres psql --single-transaction -U postgres -d omnitech`, runs before migrating and again after (new tables get grants; `drizzle` is re-trimmed). The owner URL is passed ONLY to the migrate step's environment; the web app, worker and bootstrap never receive it.
  - `.env.example` section 5 and README step 4 document both URLs. `scripts/env-docs.test.ts` passes for `DATABASE_OWNER_URL`.
  - `scripts/rls-role-guard.test.ts`: two allowlist entries for the new test (it needs an administrator handle to run the step) and a new guard, "reads DATABASE_OWNER_URL only in the migrate command", so app code cannot be handed the owner URL.
- **DK-DAT-01**: documented in `compose.yaml` (comments at the mounts) and README step 4: init runs only on an empty volume; `pnpm dev` runs the idempotent step on every start; no volume deletion is ever needed.
- **PG-DAT-01**: see below; no change.

## Tests (DB-backed, disposable Postgres 17)

- `packages/database/src/role-split.test.ts` (new, 34 tests, two scenarios: a fresh database, and a "legacy" database the runtime role owned and migrated, with a row inserted before the step). Proves: runtime passes `verifyDatabaseRole` and `verifyMigrations`; owner owns the database, every schema and every table; runtime reads/writes normally; runtime is refused (SQLSTATE 42501) for DISABLE RLS, NO FORCE, DROP POLICY, DISABLE TRIGGER, CREATE TABLE/FUNCTION in owner schemas, DROP TABLE, TRUNCATE, DELETE from the migration history, SET ROLE owner; a table created later by the owner is usable with no new grant; the runtime-created `pgboss` schema stays runtime-owned across a re-run; **a second and third run change no owner, ACL or default privilege (catalog snapshot equality)**; legacy data row and migration history intact.
- `migrate-command.test.ts`: added "migrates as DATABASE_OWNER_URL when set" (DATABASE_URL set to the DDL-less member role to prove it is not used).
- Run: `packages/database` full suite 11 files / 95 tests passed; `tsc --noEmit` clean; biome clean; `scripts`: rls-role-guard, env-docs (for my variable), package-boundaries, raw-sql-guard pass.
- Pre-existing failures not mine: `env-docs` (INTEGRATION_LINKEDIN_PKCE undocumented), `export-surface`, `route-classification` (other workers' in-flight changes).

## PG-DAT-01: policy bodies read

- `share_token_lookup`, `payload_reference_lookup`, `agent_worker_*`, `active_sessions_claim_*`, `run_worker`: pure `column = current_setting(...)` or setting-only predicates. No sub-SELECT, so no race and no leak (they read nothing another transaction can change).
- Sub-SELECT policies: `agent_*_private_parent_*` (EXISTS on `ai.agent_jobs`) and `artifact_payloads_*` (EXISTS on `platform.artifacts`). Per the PostgreSQL CREATE POLICY documentation these can in principle race with a concurrent change to the referenced row (READ COMMITTED, no row lock). They are exposed only if the referenced columns (`private`, `user_id`, `owner_user_id`, `artifact_type`, `product_id`) change after insert. I found no UPDATE that writes any of them (the job identity trigger forbids id/tenant/user/product/profile; grep of ts sources shows none for `private`, `owner_user_id`, `artifact_type`). So: documented caveat, no reachable race today. Not fixed.
- `catalog_in_tenant` is a BEFORE trigger (`platform.refuse_foreign_catalog_row`), not a policy. It checks then acts without a lock: a theoretical TOCTOU if a catalog row's `tenant_id` changed between the check and the FK lock; nothing updates it. A `FOR KEY SHARE` fix would require UPDATE privilege and pass UPDATE policies on the catalog table, risking breakage, so no change. Recommendation: keep the "referenced columns are write-once" assumption stated in ADR-0005 or a comment; add a DB trigger refusing those updates only if a feature ever needs to mutate them.

## UNVERIFIED

- The real dev volume and `docker compose exec` path in `scripts/dev.mjs` were NOT run (hard rules: no `pnpm dev`, do not touch the user's containers). The SQL itself is proven twice-safe on a legacy-layout database; the psql invocation (`--single-transaction`, `-f -` on stdin) and `init.sh` on a fresh volume are inferred from the image's documented behaviour. First `pnpm dev` after this change: container is recreated for the new port binding and mounts (volume preserved) and the step upgrades ownership; the lead should watch that start.
- pg-boss as a non-owner runtime role: not re-run here (its source is deny-listed for me); the e2e stack already runs it as the non-owner `fixture_member` with CREATE on the database, the same shape.
- A running web/worker process holding old connections is unaffected until restart.
- Apple/e2e harness not run (still uses `grantApplicationRole` and no owner URL; unchanged).

## Scope

About 330 added lines (SQL ~130, test ~250 incl. formatting, dev.mjs ~50, docs). Under 1,000; infrastructure beyond roles, grants and one SQL step (plus a 10-line init script): none.

## Wave 2 / notes

- `packages/database/drizzle.config.ts` still defaults to the runtime URL; `drizzle-kit generate` needs no DB, `migrate`/`push` would need `DATABASE_OWNER_URL` (not used by the repo's scripts).
- Production deployments must create the same two roles (run `ensure-roles.sql`, or its equivalent) and set `DATABASE_OWNER_URL` for the migration step.
- `bionic/research/concepts/platform-architecture.md:127` still describes the single role; GOV may update with the ADR.

## ADR text for GOV: separate owner/migrator and runtime database roles

**Context.** ADR-0005 d3 forces row-level security and d4 requires a NOSUPERUSER NOBYPASSRLS application role, but is silent on ownership. The local role `omnitech` owned the database and schemas, served the app and ran migrations. PostgreSQL lets an owner disable RLS, alter FORCE and drop policies, so a compromised app process or injected DDL could remove its own isolation. The compose init script also runs only on an empty volume, so a role change could not reach an existing local database.

**Decision.** Two roles, both NOSUPERUSER NOBYPASSRLS. `omnitech_owner` owns the database, schemas and tables and runs migrations (`DATABASE_OWNER_URL`, read only by the migrate command). `omnitech` is the runtime role (`DATABASE_URL`): USAGE and SELECT/INSERT/UPDATE/DELETE only, read-only on the migration history, no DDL; it keeps CREATE on the database solely so pg-boss can create its own schema. `ALTER DEFAULT PRIVILEGES FOR ROLE omnitech_owner` grants later migrations' tables to the runtime. One idempotent SQL step (`docker/postgres/ensure-roles.sql`) creates the roles or upgrades an existing database in place; it runs from the image init script on a fresh volume and from `pnpm dev` (before and after migrating) on an existing one. Postgres is published on loopback only. A single-role database still works: with no owner URL the migrator uses `DATABASE_URL`.

**Alternatives.** Keep one role (ADR-0002 simplicity): rejected, it leaves the RLS bypass-by-ownership path open. Recreate the volume: rejected, it destroys user data. Per-schema default privileges only: rejected, a new schema would be ungranted. A runtime role without CREATE on the database: deferred, pg-boss needs it (pre-create the `pgboss` schema to remove it later). Superuser migrations: rejected, the owner needs no superuser rights.

**Consequences.** A compromised app can no longer disable RLS, drop policies or run DDL on the owner's schemas (proven by DB-backed tests). Two URLs to configure; production must create both roles and set the owner URL for the migrate step. The runtime still owns the `pgboss` schema and can create further schemas. Sub-SELECT policies rely on referenced columns being write-once (PG-DAT-01).
