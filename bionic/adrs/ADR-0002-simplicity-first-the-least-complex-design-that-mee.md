---
id: ADR-0002
title: "Simplicity first: the least complex design that meets current requirements"
status: Proposed
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [architecture, simplicity, scope]
related_briefs: []
related_research: []
---

# ADR-0002 — Simplicity first: the least complex design that meets current requirements

## Context

The platform serves its products from one deployment unit
([[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]). Each
speculative layer, library or piece of infrastructure adds code to maintain
and operations to run before any requirement needs it.

## Decision

1. Choose the least complex design that meets every current requirement and
   constraint.
2. Add no speculative layers, libraries or infrastructure. Do not create a
   provider interface, event bus, remote module loader or service boundary
   for a hypothetical implementation.
3. Add an abstraction or a new boundary only for a demonstrated second
   implementation or an independent lifecycle. Independent deployment or new
   infrastructure needs a demonstrated isolation, scaling, ownership, security
   or release need.
4. Before a change that adds infrastructure or exceeds 1,000 changed lines,
   surface a scope checkpoint to the owner, unless the owner explicitly
   authorized the full change.
5. A decision needs no comparison of options and no record of rejected
   alternatives.

## Consequences

**Positive:**
- Designs stay as small as current requirements allow.
- Large or infrastructure-adding changes reach the owner before they are
  built.

**Negative:**
- A future need may be met later than a speculative design would have met it.

## References

- Repository-root `AGENTS.md` ("Architecture rules" item 1, "Engineering contract").
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
