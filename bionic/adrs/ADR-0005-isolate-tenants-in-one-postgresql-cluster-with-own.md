---
id: ADR-0005
title: "Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security"
status: Accepted
date: 2026-10-05
proposed_date: 2026-10-02
accepted_date: 2026-10-05
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

Every product stores tenant-owned data. A tenant is a workspace; one request
must never read, write or reference another workspace's rows, even through a
query bug. The platform is one deployment unit
([[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]), so a
database per product or per tenant would add operations without a demonstrated
need ([[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]).
The tables, helpers and tests that implement this model are described in
[[research/concepts/interview-domain-model]].

## Decision

1. **One cluster, owned schemas.** One shared PostgreSQL cluster holds a
   `platform` schema plus one schema per product and per owning package (for
   example `ai`, `practice`, `assistant`). Each schema is declared with Drizzle
   in the package that owns it. Cross-product discovery goes through
   `platform.artifacts`; product payloads stay opaque to other products.
2. **Tenant column.** Every tenant-owned row carries `tenant_id`, and every
   tenant-owned query is scoped by it.
3. **Defence in depth.** Every tenant-owned table has forced row-level
   security, so it binds the table owner too, on reads and writes; and every
   reference between tenant-owned rows is a composite `(tenant_id, id)` foreign
   key, so a row cannot reference another workspace's row.
4. **Transaction-local tenant context.** Tenant context is set only
   transaction-locally, by the `database` package; pool-wide session mutation
   is forbidden. Tenant-scoped Drizzle access goes through `withTenant()`,
   which refuses a superuser or RLS-bypassing role and sets the tenant and
   actor context for its transaction. Raw-client access goes through the same
   package's `tenantTransaction`, which sets the same context. The application
   connects as a role that is neither a superuser nor exempt from row-level
   security.
5. **One migration stream.** All Drizzle migrations form one stream in
   `packages/database/drizzle`, executed by the `database` package. Generated
   migrations come from the schema files; a custom migration carries what
   Drizzle cannot declare (forced row-level security, immutability triggers).
   Schema files and migrations agree, and drift tests enforce it.

6. **Narrow access outside a tenant.** A path that cannot know its tenant
   up front opens only the rows it must, through a named policy, never by
   disabling row-level security or widening a tenant policy:
   - the assistant run worker leases queued runs across members
     (`app.run_worker`);
   - the agent worker advances jobs by id, and may append events, through
     `agent_worker_read`, `agent_worker_update` and `agent_worker_append`
     (`app.agent_worker`), set only by the worker-only repository that only
     `apps/agent-worker` constructs; a job's tenant, owner, product, profile and
     prompt never change after creation;
   - an agent payload is read by its unguessable reference
     (`payload_reference_lookup`);
   - a public share link resolves one share by its token hash
     (`share_token_lookup`), then continues inside the share's tenant;
   - shared catalog rows with no tenant (built-in themes, exercises) are
     readable by every tenant and never written through one; a tenant row may
     reference a catalog row or its own tenant's row, and a `catalog_in_tenant`
     trigger refuses a reference to another tenant's row.
   A test fails if any file outside `packages/database` sets the tenant or
   actor context, or if the worker setting is used outside its one owner.

## Consequences

**Positive:**
- Tenant isolation holds even when application code forgets a filter.
- One migration history and one bootstrap path; tests run against a real
  PostgreSQL container.

**Negative:**
- Every tenant-owned table needs the convention helpers, a forced policy and
  composite keys; a table added without them is a security defect.
- All products share one cluster's capacity and maintenance windows.

## References

- `packages/database/src/with-tenant.ts` (`withTenant`), `packages/database/src/connection.ts` (`tenantTransaction`), `packages/database/src/conventions.ts`.
- `packages/database/drizzle/` (the migration stream).
- `products/interview/src/backend/db/security.test.ts` (cross-tenant refusal under forced row-level security).
- Invariants [[invariants/tenant-owned-tables-force-rls]],
  [[invariants/tenant-drizzle-handle-only-via-with-tenant]] and
  [[invariants/schema-files-and-migrations-agree]].
- [[research/concepts/interview-domain-model]]
- [[research/concepts/platform-architecture]]
