# Check — tenant-owned-tables-force-rls

- **Pin:** INV-0001 ([[invariants/tenant-owned-tables-force-rls]]) — `observed` candidate.
- **Class:** data
- **Environment:** Docker (the test starts a throwaway PostgreSQL container).

Run from the repository root:

```bash
pnpm --filter @omnitech/database exec vitest run src/migrate.test.ts
pnpm --filter @omnitech/product-interview exec vitest run src/backend/db/security.test.ts
```

**Pass:** Both exit 0. The migrate test requires forced row-level security on every RLS table in every schema; the security suite refuses cross-tenant reads, writes and references, binds the table owner, and asserts forced row-level security on every tenant-owned table.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
