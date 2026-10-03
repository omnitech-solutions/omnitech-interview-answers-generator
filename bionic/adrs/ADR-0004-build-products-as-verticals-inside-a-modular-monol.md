---
id: ADR-0004
title: "Build products as verticals inside a modular-monolith platform shell"
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
tags: [platform, architecture, products, routing, modular-monolith]
related_briefs: []
related_research: [concepts/platform-architecture, references/adding-a-product]
---

# ADR-0004 — Build products as verticals inside a modular-monolith platform shell

## Context

Retroactive record of the platform architecture already in force, stated in
the former `docs/platform-architecture.md` ("Chosen architecture", "Product
lifecycle", "Extraction criteria"), the former
`.rulesync/rules/platform-architecture.md`, and the former
`docs/adding-a-product.md` (all commit `4c50c5e`; filed as
[[research/concepts/platform-architecture]] and
[[research/references/adding-a-product]]).

Omnitech hosts several products (the interview product today, presentation,
and planned document and spreadsheet products) for multiple tenants. Each
product needs a complete vertical boundary, while the browser experience must
stay cohesive. The team has no demonstrated need for remote frontend loading,
cross-service transactions or multiple deployments
([[adrs/ADR-0002-choose-the-smallest-architecture-option-that-satis]]).

## Decision

The platform is a modular monolith: a same-origin Next.js shell, products
registered at build time, embedded Hono product backends, and one database
([[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]).

1. **Shell.** `apps/web` owns Next.js delivery, the root layout, authentication
   entrypoints, tenant resolution, global navigation, composition, and router
   mounting — nothing product-specific. Global theme, locale, identity, tenant,
   permission and installed-product context belong to the shell; products
   receive them through typed props or APIs.
2. **Products.** `products/*` own their manifest, frontend entrypoints, backend
   router, domain services and tests. Product routers are Hono applications
   that `apps/web` mounts; domain services do not import Next.js. Product
   frontend code may depend on platform contracts and shared UI, never on
   `apps/web`. Products do not share payload tables or domain services through
   `apps/web`.
3. **Registration and installation.** Trusted products are registered at build
   time; executable product code is never downloaded at runtime. Tenant
   installations enable, rename, order, hide and configure registered products
   at runtime. Manifests hold stable IDs and default copy; installation data
   owns customer-facing names, descriptions, route labels, ordering,
   visibility, settings and feature flags. The shell has no hardcoded product
   navigation item.
4. **Routing.** Every product route has the form `/t/:tenantSlug/p/:productId/*`
   and resolves an authenticated tenant membership, then installation,
   permission, manifest route and loader, before any domain work.
5. **Failure.** Duplicate products or routes fail at composition. A missing or
   disabled installation, or a missing permission, returns 404 without loading
   product code.
6. **Cohesion and extraction.** Same-origin routing, persistent shell state,
   route-level loading states and client navigation are the default.
   Independent deployment is an extraction option, taken only when one of these
   is measured: independent release ownership; materially different scaling;
   regulatory or network isolation; fault containment impossible in-process; a
   runtime or language requirement incompatible with the shell. Extraction
   keeps the manifest and domain contracts and avoids remote module execution.

## Alternatives Considered

### Option A — Micro-frontends with remote module loading
- **Pros:** Independent frontend deploys per product.
- **Cons:** Runtime code loading from remote locations, version skew, and a
  fragmented shell state.
- **Why not:** No product has an independent release need; trusted build-time
  registration is safer.

### Option B — One service and deployment per product
- **Pros:** Strong fault and scaling isolation.
- **Cons:** Cross-service transactions, duplicated auth and tenancy, and
  multiple deployments to operate.
- **Why not:** None of the extraction criteria is met; the cost buys nothing
  today.

### Option C — Products as folders inside `apps/web`
- **Pros:** Simplest wiring.
- **Cons:** No vertical boundary; product rules leak into the shell.
- **Why not:** Products would not be independently testable or extractable.

## Consequences

**Positive:**
- One deployment unit and one origin; a cohesive, SPA-like experience.
- Each product is a complete vertical that can be extracted later behind an
  HTTP adapter without changing its manifest or installation contract.

**Negative:**
- All products share one release and one process; a product fault can affect
  the shell process.
- Build-time registration means adding a product requires a deploy.

**Follow-on work:**
- Adding a product follows [[research/references/adding-a-product]].
- Invariant candidates pin the routing and import rules (see
  `bionic/invariants/`).

## References

- [[research/concepts/platform-architecture]]
- [[research/references/adding-a-product]]
- Former `.rulesync/rules/platform-architecture.md` (commit `4c50c5e`).
