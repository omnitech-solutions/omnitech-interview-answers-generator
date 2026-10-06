# Invariants

_Last updated: 2026-10-05_

The invariants concern (`bionic/AGENTS.md` §15): pinned, ratified, executable statements of *what must be true*. Each pin is a ledger page here + zero-or-more checks in the `invariants/checks/` subdirectory, reconciled via `invariants/reconciliation.yml` beside the ledger. Non-`ratified` pins are visibly marked — survey-debt must be legible.

## Pins (9)

**Survey debt: 2 `observed` pins** (INV-0002, INV-0004); both checks pass as of 2026-10-05 (the 2026-10-02 failures were stale records) and await the owner's ratification. 7 pins are `ratified`; INV-0006's check now fails (unreviewed matches, see its Check line); the other six passed on 2026-10-05.

| id | class | provenance | ratification | verification | checks | why |
|----|-------|------------|--------------|--------------|--------|-----|
| [[invariants/tenant-owned-tables-force-rls]] INV-0001 | data | recovered | ratified | pass | tenant-owned-tables-force-rls.md | ADR-0005 |
| [[invariants/tenant-drizzle-handle-only-via-with-tenant]] INV-0002 | contract | recovered | **observed** | pass | tenant-drizzle-handle-only-via-with-tenant.md | ADR-0005 |
| [[invariants/schema-files-and-migrations-agree]] INV-0003 | shape | recovered | ratified | pass | schema-files-and-migrations-agree.md | ADR-0005 |
| [[invariants/product-routes-resolve-membership-first]] INV-0004 | behavior | recovered | **observed** | pass | product-routes-resolve-membership-first.md | ADR-0004 |
| [[invariants/nextjs-never-launches-agent-processes]] INV-0005 | contract | recovered | ratified | pass | nextjs-never-launches-agent-processes.md | ADR-0007 |
| [[invariants/products-never-branch-on-provider-names]] INV-0006 | contract | recovered | ratified | fail | products-never-branch-on-provider-names.md | ADR-0007 |
| [[invariants/product-frontend-never-imports-apps-web]] INV-0007 | contract | recovered | ratified | pass | product-frontend-never-imports-apps-web.md | ADR-0004 |
| [[invariants/product-domain-never-imports-nextjs]] INV-0008 | contract | recovered | ratified | pass | product-domain-never-imports-nextjs.md | ADR-0004 |
| [[invariants/package-boundaries-hold]] INV-0009 | contract | recovered | ratified | pass | package-boundaries-hold.md | ADR-0003, ADR-0004, ADR-0007 |
