# Check — product-routes-resolve-membership-first

- **Pin:** INV-0004 ([[invariants/product-routes-resolve-membership-first]]) — `observed` candidate.
- **Class:** behavior
- **Environment:** None beyond the package test setup.

Run from the repository root:

```bash
pnpm exec vitest run packages/platform-api/src/router.test.ts
```

**Pass:** Exit 0, with cases showing a non-member, a disabled installation and a missing permission each receive 404 before any product handler runs. If the suite lacks one of those cases the check is incomplete, not passing.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
