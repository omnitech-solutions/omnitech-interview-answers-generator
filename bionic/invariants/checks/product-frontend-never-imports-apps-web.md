# Check — product-frontend-never-imports-apps-web

- **Pin:** INV-0007 ([[invariants/product-frontend-never-imports-apps-web]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -E "from ['\"](@omnitech/web|[./]*apps/web)" -- 'products/*/src/**'
```

**Pass:** No output (exit 1 from `git grep`).

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
