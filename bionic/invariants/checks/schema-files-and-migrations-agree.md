# Check — schema-files-and-migrations-agree

- **Pin:** INV-0003 ([[invariants/schema-files-and-migrations-agree]]) — `observed` candidate.
- **Class:** shape
- **Environment:** Docker (throwaway PostgreSQL containers).

Run from the repository root:

```bash
pnpm --filter @omnitech/database exec vitest run src/migrate.test.ts && pnpm --filter @omnitech/platform-storage exec vitest run src/schema/schema.test.ts && pnpm --filter @omnitech/product-interview exec vitest run src/backend/db/schema.test.ts
```

**Pass:** All three commands exit 0.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
