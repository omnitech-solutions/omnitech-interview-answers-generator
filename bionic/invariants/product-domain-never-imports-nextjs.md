---
id: INV-0008
class: contract
provenance: recovered
ratification: ratified
verification:
  last_result: pass
related_adrs: [ADR-0004]
related_briefs: []
checks: [product-domain-never-imports-nextjs.md]
---

# INV-0008 — product-domain-never-imports-nextjs

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** Product backends and domain services expose Hono applications and never import Next.js.

**Why:** [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]].

**Recovery confidence:** **contract** — high confidence (mechanical import check).

**Check:** [[invariants/checks/product-domain-never-imports-nextjs]] — run 2026-10-05; `last_result: pass`.
