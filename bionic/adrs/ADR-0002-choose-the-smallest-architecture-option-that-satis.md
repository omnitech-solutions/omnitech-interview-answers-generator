---
id: ADR-0002
title: "Choose the smallest architecture option that satisfies current requirements"
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

# ADR-0002 — Choose the smallest architecture option that satisfies current requirements

## Context

Retroactive record of a rule already in force. The former
`.rulesync/rules/simplicity-first.md` (commit `4c50c5e`) made a "simplicity
gate" mandatory for architecture choices, and the former
`.rulesync/rules/base.md` stated the matching engineering contract: prefer the
smallest complete change, avoid speculative layers, libraries or architecture,
and add an abstraction only for a demonstrated second implementation or a real
lifecycle boundary.

The platform itself is built on this rule: it is a modular monolith whose
products stay embedded until an extraction criterion is measured
([[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]).

## Decision

1. For non-trivial architecture work, compare three bounded options before
   choosing:
   - **Small** — the existing runtime, database, and deployment unit.
   - **Intermediate** — one new package boundary or lifecycle seam.
   - **Distributed** — independent deployment or infrastructure.
2. Choose the smallest option that satisfies every current requirement. A
   distributed option requires a demonstrated isolation, scaling, ownership,
   security, or release need.
3. Estimate changed lines and operational components for the chosen option. If
   it adds infrastructure or exceeds 1,000 changed lines, surface a scope
   checkpoint to the owner before implementation, unless the owner explicitly
   authorized the full change.
4. Do not create a provider interface, event bus, remote module loader, or
   service boundary for a hypothetical implementation. Do define a narrow
   boundary when a second implementation exists or a lifecycle is already
   independent.

## Alternatives Considered

### Option A — Design for anticipated scale up front
- **Pros:** Fewer later migrations if growth arrives as predicted.
- **Cons:** Pays operational and cognitive cost now for needs that may never
  arrive; speculative interfaces calcify the wrong seams.
- **Why not:** The repository's requirements are met in one deployment unit.

### Option B — No explicit gate; rely on reviewer judgment
- **Pros:** No process step.
- **Cons:** Scope growth is noticed after the work is done; the 1,000-line and
  new-infrastructure thresholds give the owner a decision point before it.
- **Why not:** A stated gate makes the trade-off visible and reviewable.

## Consequences

**Positive:**
- Architecture changes arrive with an explicit comparison and a size estimate.
- Large or infrastructure-adding changes reach the owner before they are built.

**Negative:**
- The comparison adds a step to small architectural changes.
- A legitimate future need may be met later than a speculative design would
  have met it.

**Follow-on work:**
- Crux `dev-cycle` and `whiteboarding` sessions apply this gate when weighing
  alternatives ([[adrs/ADR-0001-crux-is-the-sole-ai-development-workflow]]).

## References

- Former `.rulesync/rules/simplicity-first.md` and `.rulesync/rules/base.md` (commit `4c50c5e`).
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
