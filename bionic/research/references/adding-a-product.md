---
title: "Add a product to the platform"
slug: adding-a-product
type: references
tags: [platform, products, how-to]
sources: []
last_reviewed: 2026-10-02
---

# Add a product to the platform

Use `products/<product-id>` for a complete product vertical. Why products are
verticals, and what the shell may and may not own, is decided in
[[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]; the
platform shape is in [[research/concepts/platform-architecture]].

## Required public surfaces

```text
products/example/
├── package.json
├── src/
│   ├── manifest.tsx
│   ├── frontend/
│   │   └── index.ts
│   └── backend/
│       └── index.ts
├── tsconfig.json
└── vitest.config.ts
```

## Steps

1. Define a stable, namespaced manifest ID and route IDs.
2. Export frontend loaders whose components accept `ProductPageProps`.
3. Export a Hono application from the backend entrypoint.
4. Register the manifest and frontend in
   `apps/web/src/platform/registry.ts`.
5. Mount the backend in `apps/web/src/platform/api.ts`.
6. Add a tenant installation configuration in bootstrap data or the tenant
   administration API.
7. Declare the product's schema with Drizzle in the owning product (or a narrow
   storage package) and generate its migration into the shared stream with
   `pnpm --filter @omnitech/database db:generate`.
8. Verify collisions, disabled installation behavior, permissions, tenant
   isolation, route loading, and backend contracts.

Default labels belong in the manifest. Customer-facing labels, descriptions,
paths, ordering, and visibility belong to the tenant installation. Do not add a
hardcoded product item to the shell navigation.

## Document-generation products

Document-generation products use separate IDs and payload schemas:

- `omnitech.presentation` for slide and canvas generation;
- `omnitech.document` for a block-based document builder and DOCX export;
- `omnitech.spreadsheet` for workbook generation and analysis.

They may share artifact metadata, provider connections, design tokens, and
export infrastructure. They must not share product payload tables or domain
services through `apps/web`.
