# Check — tenant-drizzle-handle-only-via-with-tenant

- **Pin:** INV-0002 ([[invariants/tenant-drizzle-handle-only-via-with-tenant]]) — `observed` candidate.
- **Class:** contract
- **Environment:** None.

Run from the repository root:

```bash
pnpm exec vitest run scripts/tenant-context-boundary.test.ts scripts/rls-role-guard.test.ts
```

**Pass:** Exit 0. `tenant-context-boundary.test.ts` fails when any production file outside `packages/database` sets the tenant or actor context (tests and their fixtures stand in for the package on purpose) or when a cross-tenant setting is set outside its one owner; `rls-role-guard.test.ts` fails when the role-check opt-in leaks outside its allowlist.

History: until 2026-10-05 this check was the literal `git grep -n -E "set_config\('app\.(tenant|actor)_id'" -- '*.ts' ':!*.test.ts' ':!packages/database/src/**'`, which also matches test fixtures and so could not pass. The repository guard above is the same rule with the fixture exemption written down and tested.

Record the outcome in `bionic/invariants/reconciliation.yml` (`last_result`, `last_checked`).
