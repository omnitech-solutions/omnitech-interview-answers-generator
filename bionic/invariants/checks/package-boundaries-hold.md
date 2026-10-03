# Check — package-boundaries-hold

- **Pin:** INV-0009 ([[invariants/package-boundaries-hold]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
pnpm exec vitest run scripts/package-boundaries.test.ts
```

**Pass:** Exit 0. A failure names the package, file:line and the boundary rule it breaks.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
