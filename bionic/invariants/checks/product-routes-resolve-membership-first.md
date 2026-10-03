# Check — product-routes-resolve-membership-first

- **Pin:** INV-0004 ([[invariants/product-routes-resolve-membership-first]]) — `observed` candidate.
- **Class:** behavior
- **Environment:** None beyond the package test setup.

Run from the repository root:

```bash
pnpm exec vitest run packages/platform-runtime/src/registry.test.ts "apps/web/app/api/[[...route]]/route.test.ts"
```

**Pass:** Exit 0, with cases showing a non-member, a disabled installation, a missing permission and (for starting an agent job) an uninstalled product each receive 404 before any product code or job is written. If the suite lacks one of those cases the check is incomplete, not passing.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
