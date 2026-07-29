# Add a product

Use `products/<product-id>` for a complete product vertical.

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

1. Define a stable, namespaced manifest ID and route IDs.
2. Export frontend loaders whose components accept `ProductPageProps`.
3. Export a Hono application from the backend entrypoint.
4. Register the manifest and frontend in
   `apps/web/src/platform/registry.ts`.
5. Mount the backend in `apps/web/src/platform/api.ts`.
6. Add a tenant installation configuration in bootstrap data or the tenant
   administration API.
7. Add product-schema migrations under the owning product or a narrow storage
   package.
8. Verify collisions, disabled installation behavior, permissions, tenant
   isolation, route loading, and backend contracts.

Default labels belong in the manifest. Customer-facing labels, descriptions,
paths, ordering, and visibility belong to the tenant installation. Do not add a
hardcoded product item to the shell navigation.

Document-generation products should use separate IDs and payload schemas:

- `omnitech.presentation` for slide and canvas generation;
- `omnitech.document` for a block-based document builder and DOCX export;
- `omnitech.spreadsheet` for workbook generation and analysis.

They may share artifact metadata, provider connections, design tokens, and
export infrastructure. They must not share product payload tables or domain
services through `apps/web`.
