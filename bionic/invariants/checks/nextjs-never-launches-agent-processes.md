# Check — nextjs-never-launches-agent-processes

- **Pin:** INV-0005 ([[invariants/nextjs-never-launches-agent-processes]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
git grep -n -E "agent-runtime-(claude|codex)|child_process" -- apps/web
```

**Pass:** No output (exit 1 from `git grep`): `apps/web` depends on no agent runtime implementation and imports no process-spawning module.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
