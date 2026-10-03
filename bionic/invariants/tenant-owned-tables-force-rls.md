---
id: INV-0001
class: data
provenance: recovered
ratification: observed
verification:
  last_result: none
related_adrs: [ADR-0005]
related_briefs: []
checks: [tenant-owned-tables-force-rls.md]
---

# INV-0001 — tenant-owned-tables-force-rls

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** Every tenant-owned table has `tenant_id`, forced row-level security on reads and writes, and composite `(tenant_id, id)` foreign keys.

**Why:** [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]].

**Recovery confidence:** **data** — medium confidence. Stated in [[research/concepts/interview-domain-model]] ("Invariants", item 1) and asserted by an existing integration test; recovered from documentation and test names, not from a full schema walk.

**Check:** [[invariants/checks/tenant-owned-tables-force-rls]] — not yet run; `last_result: none`.
