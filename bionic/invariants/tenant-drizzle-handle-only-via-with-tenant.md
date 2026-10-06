---
id: INV-0002
class: contract
provenance: recovered
ratification: observed
verification:
  last_result: pass
related_adrs: [ADR-0005, ADR-0023]
related_briefs: []
checks: [tenant-drizzle-handle-only-via-with-tenant.md]
---

# INV-0002 — tenant-drizzle-handle-only-via-with-tenant

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** Tenant context is set only transaction-locally, by the `database` package; no tenant-scoped handle exists outside `withTenant()` and `tenantTransaction`, and every path runs the same database-role check ([[adrs/ADR-0023-use-the-query-builder-by-default-and-check-the-dat]]).

**Why:** [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] (Accepted 2026-10-05) and [[adrs/ADR-0023-use-the-query-builder-by-default-and-check-the-dat]].

**Recovery confidence:** **contract** — medium confidence. Raw `pg` code uses `tenantTransaction` (also in `packages/database`), so this candidate covers Drizzle handles plus the package boundary that alone sets tenant context, matching [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] Decision 4.

**Check:** [[invariants/checks/tenant-drizzle-handle-only-via-with-tenant]] — run 2026-10-05; `last_result: pass`. The 2026-10-02 `fail` named `packages/platform-storage/src/bootstrap.ts`, `products/presentation/src/repositories/index.ts` and `products/interview/src/backend/assistant/workspace.ts`; those files now enter a tenant through the `database` package (`enterTenant`, `tenantTransaction`), so the record was stale. The check's literal `git grep` also matched three test-fixture files (`workspace-fixture.ts`, `processor-fixture.ts`, `products/presentation/integration/repository.ts`) that stand in for the `database` package on purpose; the check now runs the repository guard that already encodes that exemption.
