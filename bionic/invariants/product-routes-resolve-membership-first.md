---
id: INV-0004
class: behavior
provenance: recovered
ratification: observed
verification:
  last_result: none
related_adrs: [ADR-0004]
related_briefs: []
checks: [product-routes-resolve-membership-first.md]
---

# INV-0004 — product-routes-resolve-membership-first

> **observed** — a recovered candidate, not a ratified invariant. Only the owner
> ratifies or rejects it, via `transition-invariant`.

**Intent:** Every product route under `/t/:tenantSlug/p/:productId/*` resolves an authenticated tenant membership, then installation, permission, manifest route and loader, before any domain work; a missing installation or permission returns 404 without loading product code.

**Why:** [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]].

**Recovery confidence:** **behavior** — low confidence (characterization candidate). The ordering is stated by the platform docs; the named test exercises the platform API router and may cover only part of the ordering. A pass would pin current behavior, not prove intent.

**Check:** [[invariants/checks/product-routes-resolve-membership-first]] — not yet run; `last_result: none`.
