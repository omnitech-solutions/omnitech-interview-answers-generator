---
id: INV-0002
class: contract
provenance: recovered
ratification: observed
verification:
  last_result: none
related_adrs: [ADR-0005]
related_briefs: []
checks: [tenant-drizzle-handle-only-via-with-tenant.md]
---

# INV-0002 — tenant-drizzle-handle-only-via-with-tenant

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** No tenant-scoped Drizzle handle exists outside `withTenant()`; tenant context is set only transaction-locally by the `database` package.

**Why:** [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]].

**Recovery confidence:** **contract** — medium confidence. The former doc stated the broader "no tenant-scoped database handle outside `withTenant()`"; at commit `4c50c5e` raw `pg` code uses `tenantTransaction` (also in `packages/database`), so this candidate is narrowed to Drizzle handles plus the package boundary. Ratification should settle which wording is intended.

**Check:** [[invariants/checks/tenant-drizzle-handle-only-via-with-tenant]] — not yet run; `last_result: none`.
