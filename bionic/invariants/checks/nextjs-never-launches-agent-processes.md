# Check — nextjs-never-launches-agent-processes

- **Pin:** INV-0005 ([[invariants/nextjs-never-launches-agent-processes]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -E "agent-runtime-(claude|codex)|child_process" -- apps/web ':!apps/web/next.config.ts' ':!*.test.*'
```

**Scope:** production source under `apps/web`. `next.config.ts` is excluded because it runs at build time (`execSync` for the build id, never at request time), and test files are excluded because they start a disposable database with `execFile`.

**Pass:** No output (exit 1 from `git grep`): the shipped `apps/web` code depends on no agent runtime implementation and imports no process-spawning module.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
