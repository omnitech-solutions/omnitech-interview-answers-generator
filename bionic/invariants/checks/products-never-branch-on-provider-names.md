# Check — products-never-branch-on-provider-names

- **Pin:** INV-0006 ([[invariants/products-never-branch-on-provider-names]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -i -E "openai|anthropic|lm[-_ ]?studio|gpt-|claude-" -- 'products/*/src/**' ':!*.test.ts' ':!*.test.tsx'
```

**Pass:** No output (exit 1 from `git grep`), or only matches the owner has reviewed and judged not to be a branch on a provider or model name.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
