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

Omnitech hosts several products (Interview Studio and Presentation today) for
multiple tenants. Each product needs a complete vertical boundary, while the
browser experience must stay cohesive. No product needs remote frontend
loading, cross-service transactions or a separate deployment
([[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]). The
platform shape and the steps for adding a product are in
[[research/concepts/platform-architecture]] and
[[research/references/adding-a-product]].

## Decision

The platform is a modular monolith: a same-origin Next.js shell, products
registered at build time, embedded Hono product backends, and one database
([[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]).

1. **Shell.** `apps/web` owns Next.js delivery, the root layout, authentication
   entrypoints, tenant resolution, global navigation, composition, and router
   mounting. It holds no product logic or product styling: composing a product
   means registering its manifest, mounting its backend, importing its exported
   stylesheet, and hosting a public page the product supplies. Global theme,
   locale, identity, tenant, permission and installed-product context belong to
   the shell; products receive them through typed props or APIs, including the
   links to the tenant's other products, so a product can offer a way to the
   others without knowing which exist. A product's root opens its first route
   when it has no home page.
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

## Consequences

**Positive:**
- One deployment unit and one origin; a cohesive, SPA-like experience.
- Each product is a complete vertical that can be extracted later behind an
  HTTP adapter without changing its manifest or installation contract.

**Negative:**
- All products share one release and one process; a product fault can affect
  the shell process.
- Build-time registration means adding a product requires a deploy.

## References

- `packages/platform-runtime/src/registry.ts` (build-time registration and route resolution).
- `packages/platform-api/src/router.ts` and the product page route under `apps/web/app/t/[tenantSlug]/p/[productId]/` (membership-first routing).
- Invariant checks [[invariants/checks/product-routes-resolve-membership-first]],
  [[invariants/checks/product-frontend-never-imports-apps-web]] and
  [[invariants/checks/product-domain-never-imports-nextjs]].
- [[research/concepts/platform-architecture]]
- [[research/references/adding-a-product]]
