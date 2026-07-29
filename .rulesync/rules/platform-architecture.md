---
targets: ["*"]
description: Product platform, tenancy, API, and storage invariants
---

# Platform architecture

- `apps/web` owns Next.js delivery, root layout, authentication entrypoints,
  tenant resolution, global navigation, and composition only.
- `products/*` own product manifests, frontend entrypoints, backend routers,
  domain services, and product tests.
- `packages/platform-*` own framework-neutral contracts and platform services.
- Register trusted products at build time. Tenant installations enable, rename,
  order, hide, and configure registered products at runtime.
- All product routes use `/t/:tenantSlug/p/:productId/*`. Every read and write
  resolves an authenticated tenant membership before domain work.
- The shared PostgreSQL cluster uses a `platform` schema plus one schema per
  product. Every tenant-owned row includes `tenant_id`; transactional row-level
  security is defense in depth.
- Login identities prove who the user is. Connected accounts separately
  authorize provider actions. Never reuse login tokens for product integrations.
- Product frontend code may depend on platform contracts and shared UI, never
  on `apps/web`.
- Product routers expose Hono applications. `apps/web` mounts them; domain
  services do not import Next.js.
- Product manifests contain stable IDs and default copy. Installation data owns
  customer-facing names, descriptions, route labels, ordering, visibility,
  settings, and feature flags.
- Global theme, locale, identity, tenant, permission, and installed-product
  context belongs to the shell. Products receive it through typed props or
  APIs.
- Keep the browser experience cohesive with same-origin routing, persistent
  shell state, route-level loading states, and client navigation. Independent
  deployment is an extraction option, not the default.
