# Invariants

_Last updated: 2026-10-02_

The invariants concern (`bionic/AGENTS.md` §15): pinned, ratified, executable statements of *what must be true*. Each pin is a ledger page here + zero-or-more checks in the `invariants/checks/` subdirectory, reconciled via `invariants/reconciliation.yml` beside the ledger. Non-`ratified` pins are visibly marked — survey-debt must be legible.

## Pins (8)

**Survey debt: 8 `observed` pins awaiting owner ratification** via `transition-invariant`. None is ratified; no check has a recorded result.

| id | class | provenance | ratification | verification | checks | why |
|----|-------|------------|--------------|--------------|--------|-----|
| [[invariants/tenant-owned-tables-force-rls]] INV-0001 | data | recovered | **observed** | none | tenant-owned-tables-force-rls.md | ADR-0005 |
| [[invariants/tenant-drizzle-handle-only-via-with-tenant]] INV-0002 | contract | recovered | **observed** | none | tenant-drizzle-handle-only-via-with-tenant.md | ADR-0005 |
| [[invariants/schema-files-and-migrations-agree]] INV-0003 | shape | recovered | **observed** | none | schema-files-and-migrations-agree.md | ADR-0005 |
| [[invariants/product-routes-resolve-membership-first]] INV-0004 | behavior | recovered | **observed** | none | product-routes-resolve-membership-first.md | ADR-0004 |
| [[invariants/nextjs-never-launches-agent-processes]] INV-0005 | contract | recovered | **observed** | none | nextjs-never-launches-agent-processes.md | ADR-0007 |
| [[invariants/products-never-branch-on-provider-names]] INV-0006 | contract | recovered | **observed** | none | products-never-branch-on-provider-names.md | ADR-0007 |
| [[invariants/product-frontend-never-imports-apps-web]] INV-0007 | contract | recovered | **observed** | none | product-frontend-never-imports-apps-web.md | ADR-0004 |
| [[invariants/product-domain-never-imports-nextjs]] INV-0008 | contract | recovered | **observed** | none | product-domain-never-imports-nextjs.md | ADR-0004 |
