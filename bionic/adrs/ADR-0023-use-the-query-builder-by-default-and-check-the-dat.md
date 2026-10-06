---
id: ADR-0023
title: "Use the query builder by default and check the database role on every tenant-scoped path"
status: Accepted
date: 2026-10-05
proposed_date: 2026-10-04
accepted_date: 2026-10-05
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0005]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [tenancy, drizzle, postgresql, security, data-access]
related_briefs: []
related_research: []
---

# ADR-0023 — Use the query builder by default and check the database role on every tenant-scoped path

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

ADR-0005 makes Drizzle the owner of schema and migrations and says tenant-scoped access goes through `withTenant()`, but it also sanctions raw-client access through `tenantTransaction`. In practice the query builder serves one repository family; most tenant-scoped code is raw parameterised SQL, either through the raw client or as `sql` statements on a Drizzle handle. The audit in `bionic/inbox/redesign/drizzle-audit.md` found three gaps:

- Only `withTenant()` refused a superuser or `BYPASSRLS` role. `tenantTransaction` and `enterTenant` did not, so a mis-provisioned role silently removed isolation from every raw site (audit F1).
- AGENTS.md rule 5 and INV-0002 say tenant-scoped Drizzle goes through `withTenant()`, which the raw paths contradict (F2).
- Two migration mechanisms exist beside the Drizzle stream and are unstated, and one view is not declared in Drizzle (F3).

Migrating every raw site is about 5,500 changed lines, well above the scope checkpoint of ADR-0002. The standard has to be stated now so that raw SQL stops growing; migration proceeds repository by repository.

## Decision

1. **The data-access standard.** Drizzle owns schema and the single migration stream. The query builder is the default for new tenant-scoped repository code. Raw parameterised SQL through `tenantTransaction` or `enterTenant`, or as a `sql` statement on a Drizzle handle, is permitted only for:
   - `set_config` of the cross-tenant settings ADR-0005 Decision 6 names;
   - advisory locks and full-text search;
   - catalog and coverage queries that touch no tenant-owned table;
   - single-statement data-modifying CTEs the builder cannot express;
   - vendor migrations and the role check;
   - repositories on the guard's allowlist, until each is migrated.
2. **One role check, a property of the database handle.** A database handle refuses to serve any query when its role bypasses row-level security (superuser or `BYPASSRLS`) unless it was created with the explicit opt-in; the opt-in is allowlisted by a test. Without the opt-in every entry of the handle (`query`, `transaction`, `tenantTransaction`, `withTenant`) awaits one memoised check implemented once in the `database` package, and `enterTenant` checks the client it is given. The refusal is one fixed message that carries no SQL, tenant, actor or data and tells a test author to use the application role. An unrecognised lookup result is refused, and a failed lookup is retried, not cached. A long-running process verifies its handle at start, so a mis-provisioned `DATABASE_URL` stops it at boot.
3. **The guards are tests.** A second test keeps the opt-in confined and fails when a test or script hands the owner URL to application code. A repository test scans production TypeScript and fails on raw `pg` queries or `sql` statements in any file not on a typed allowlist, or above that file's cap. Each entry states why it is raw. Entries are lowered as repositories migrate and removed at zero; a new entry needs a stated reason.
4. **Pinned settings.** Every `app.*` setting that widens access beyond the transaction tenant is set only by its named owner file or files, enforced by the tenant-context boundary test. This includes the share-token, agent-payload-reference and document-catalog-provisioner settings.
5. **Second migration mechanism, declared.** The vendor `assistant` schema is applied from the vendor package's SQL files, and the `pgboss` schema is created by pg-boss at runtime. Neither is declared in Drizzle, neither is queried by product SQL, and the Drizzle configuration excludes both. The `interview.active_session_claims` view is created by a hand-written migration inside the Drizzle stream and is not declared in Drizzle; it is read only by the session claim.
6. **How the standing documents read once this is accepted.** AGENTS.md rule 5 states that tenant-scoped access goes through `withTenant()` or `tenantTransaction`, that the builder is the default, and that every path runs the same role check. INV-0002 states that tenant context is set only by the `database` package and that no tenant-scoped handle exists outside `withTenant` and `tenantTransaction`.

## Alternatives Considered

### Option A — Migrate all raw SQL to the builder now
- **Pros:** One style everywhere.
- **Cons:** About 5,500 changed lines across live-session, presentation and storage, with unproven builder support for claim and event-sequence statements.
- **Why not:** Exceeds the scope checkpoint without a demonstrated defect; the guard stops growth at far lower cost.

### Option B — Forbid raw SQL outright
- **Pros:** Simplest rule.
- **Cons:** Cross-tenant settings, advisory locks, full-text search and vendor migrations have no builder form.
- **Why not:** The rule would be broken on day one and ignored.

### Option C — Leave ADR-0005 as written
- **Pros:** No change.
- **Cons:** The raw paths keep running without the role check and the documents contradict the code.
- **Why not:** Isolation silently depends on role provisioning.

## Consequences

**Positive:**
- Isolation no longer depends on which entry point a repository chose.
- New raw SQL is visible in review as an allowlist change.
- The documents match the code.

**Negative:**
- One more cheap query per database or connection, once.
- A test environment that connects tenant-scoped code as a superuser now fails and must use the application role.
- The allowlist caps are a count and need upkeep when a file legitimately changes.

**Follow-on work:**
- Migrate allowlisted repositories to the builder in the audit's order, lowering caps as each lands.
- Replace the raw statement seam in the live-session draft helper with a typed one.
- Declare the claim view with Drizzle if the claim moves to the builder.

## References

- `bionic/inbox/redesign/drizzle-audit.md` (findings F1 to F4 and the inventory).
- `packages/database/src/connection.ts` (the shared role check), `packages/database/src/with-tenant.ts`.
- `scripts/raw-sql-guard.test.ts`, `scripts/rls-role-guard.test.ts` and `scripts/tenant-context-boundary.test.ts`.
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]], [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]].
- [[invariants/tenant-drizzle-handle-only-via-with-tenant]]
