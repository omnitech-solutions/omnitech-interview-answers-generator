# Check — tenant-drizzle-handle-only-via-with-tenant

- **Pin:** INV-0002 ([[invariants/tenant-drizzle-handle-only-via-with-tenant]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -E "set_config\('app\.(tenant|actor)_id'" -- '*.ts' ':!*.test.ts' ':!packages/database/src/**'
```

**Pass:** No output (exit 1 from `git grep`): only `packages/database/src` sets the tenant or actor context.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
