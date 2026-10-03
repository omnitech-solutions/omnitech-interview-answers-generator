---
id: ADR-0005
title: "Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security"
status: Proposed
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [tenancy, storage, postgresql, security, drizzle]
related_briefs: []
related_research: [concepts/interview-domain-model, concepts/platform-architecture]
---

# ADR-0005 — Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security

## Context

Retroactive record of the storage and tenancy model already in force, stated in
the former `.rulesync/rules/platform-architecture.md`, the former
`docs/platform-architecture.md` ("Data ownership", "Local operations"), and the
former `docs/architecture/interview-domain.md` ("Tenancy and isolation",
"Database packages", "Migrations", "Invariants") — all commit `4c50c5e`, filed
as [[research/concepts/platform-architecture]] and
[[research/concepts/interview-domain-model]].

Every product stores tenant-owned data. A tenant is a workspace; one request
must never read, write or reference another workspace's rows, even through a
query bug. The platform is one deployment unit
([[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]), so a
database per product or per tenant would add operations without a demonstrated
need ([[adrs/ADR-0002-choose-the-smallest-architecture-option-that-satis]]).

## Decision

1. **One cluster, owned schemas.** One shared PostgreSQL cluster holds a
   `platform` schema plus one schema per product (and per owning package, e.g.
   `ai`, `practice`, `assistant`). Each schema is declared with Drizzle in the
   package that owns it. Cross-product discovery goes through
   `platform.artifacts`; product payloads stay opaque to other products.
2. **Tenant column.** Every tenant-owned row carries `tenant_id`, and every
   tenant-owned query is scoped by it.
3. **Defence in depth.** Every tenant-owned table has row-level security that
   is *forced*, so it binds the table owner too, on reads and writes; and every
   reference between tenant-owned rows is a composite `(tenant_id, id)` foreign
   key, so a row cannot reference another workspace's row.
4. **Transaction-local tenant context.** Tenant context is set only
   transaction-locally, by the `database` package; pool-wide session mutation
   is forbidden. A tenant-scoped Drizzle handle exists only inside
   `withTenant()`, which refuses a superuser or RLS-bypassing role and sets the
   tenant and actor context for its transaction. The application connects as a
   role that is neither a superuser nor exempt from row-level security.
5. **One migration stream.** All Drizzle migrations form one stream in
   `packages/database/drizzle`, executed by the `database` package. Generated
   migrations come from the schema files; a custom migration carries what
   Drizzle cannot declare (forced row-level security, immutability triggers).
   Schema files and migrations agree, and drift tests enforce it.

The table helpers, policy expression and test inventory that implement this
are described in [[research/concepts/interview-domain-model]].

## Alternatives Considered

### Option A — Database (or cluster) per tenant
- **Pros:** Strongest isolation; per-tenant backup and restore.
- **Cons:** Provisioning, migration fan-out and connection pools per tenant.
- **Why not:** No regulatory or scale requirement demands it.

### Option B — `tenant_id` filtering in application code only
- **Pros:** Simple; no database policy machinery.
- **Cons:** One missing `WHERE` clause leaks data across workspaces.
- **Why not:** Forced RLS and composite keys make the database a second,
  independent boundary.

### Option C — Per-package migration streams
- **Pros:** Each owner ships its migrations independently.
- **Cons:** Ordering across owners becomes implicit; cross-schema references
  and policies are harder to apply in one consistent order.
- **Why not:** One stream gives one recorded order. The vendored assistant
  package, which ships its own migrations, runs before the stream.

## Consequences

**Positive:**
- Tenant isolation holds even when application code forgets a filter.
- One migration history and one bootstrap path; tests run against a real
  PostgreSQL container.

**Negative:**
- Every tenant-owned table needs the convention helpers, a forced policy and
  composite keys; a table added without them is a security defect.
- All products share one cluster's capacity and maintenance windows.

**Follow-on work:**
- Invariant candidates pin forced RLS on every tenant-owned table and the
  `withTenant()`-only Drizzle handle (see `bionic/invariants/`).
- The former interview-domain doc stated the broader "no tenant-scoped
  database handle outside `withTenant()`". At commit `4c50c5e` raw-client code
  still uses the `database` package's `tenantTransaction`, which also sets the
  tenant context transaction-locally. The owner decides whether raw-client
  access should migrate to `withTenant()`.

## References

- [[research/concepts/interview-domain-model]]
- [[research/concepts/platform-architecture]]
- Former `.rulesync/rules/platform-architecture.md` and `.rulesync/rules/packages.md` (commit `4c50c5e`).
