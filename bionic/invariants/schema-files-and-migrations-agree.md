---
id: INV-0003
class: shape
provenance: recovered
ratification: observed
verification:
  last_result: none
related_adrs: [ADR-0005]
related_briefs: []
checks: [schema-files-and-migrations-agree.md]
---

# INV-0003 — schema-files-and-migrations-agree

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** Schema files and the single Drizzle migration stream agree: a fresh database reaches the current schema, a second migration run changes nothing, and every declared table, column, foreign key and policy exists after migration.

**Why:** [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]].

**Recovery confidence:** **shape** — high confidence. Stated as invariant 3 of the former interview-domain doc and enforced by existing migrate and schema-drift tests.

**Check:** [[invariants/checks/schema-files-and-migrations-agree]] — not yet run; `last_result: none`.
