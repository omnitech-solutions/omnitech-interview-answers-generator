# Check — product-domain-never-imports-nextjs

- **Pin:** INV-0008 ([[invariants/product-domain-never-imports-nextjs]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -E "from ['\"]next(/|['\"])" -- 'products/*/src/backend/**'
```

**Pass:** No output (exit 1 from `git grep`).

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
