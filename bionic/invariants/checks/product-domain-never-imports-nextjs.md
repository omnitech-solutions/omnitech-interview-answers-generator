# Check — product-domain-never-imports-nextjs

- **Pin:** INV-0008 ([[invariants/product-domain-never-imports-nextjs]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -E "from ['\"]next(/|['\"])" -- 'products/*/src/**'
```

**Scope:** all of `products/*/src` (backend, frontend, manifest and shared code): only `apps/web` may import Next.js. biome.json also enforces this edge through `noRestrictedImports`.

**Pass:** No output (exit 1 from `git grep`).

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
