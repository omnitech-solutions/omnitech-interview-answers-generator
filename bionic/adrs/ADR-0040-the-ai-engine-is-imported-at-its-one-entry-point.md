---
id: ADR-0040
title: "The AI engine is imported at its one entry point"
status: Accepted
date: 2026-10-08
proposed_date: 2026-10-08
accepted_date: 2026-10-08
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0037]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [ai, sdk, engine, packages, boundaries]
related_briefs: []
related_research: []
governs: []
---

# ADR-0040 — The AI engine is imported at its one entry point

## Context

ADR-0037 decided that Studio reaches every model, image and agent runtime through one SDK. It did
not say how a host reaches the SDK. The owner's direction after the migration: the engine is
supposed to be an SDK with one entry point; a provider such as Claude is an implementation detail
and private; every use across the code base that works around this is to be refactored, and
working around it is to be made impossible going forward.

Left as a convention, a deep import of an adapter would return the first time it saved a line.

## Decision

- Every import of the engine in this repository names the package and nothing below it. A host
  does not import an adapter, a runtime implementation or any other internal file of the engine.
- A host chooses an implementation by naming it to the engine: an agent runtime by its runtime
  name, a model provider by its kind, and the place its runs are kept by a locator. The
  adapters stay private to the engine.
- Only the agent worker may start an agent runtime (ADR-0007). The check is about who asks for
  one, so a web host, a product or a package that asks fails.
- The repository's boundary test enforces both rules and fails the build on a violation. It is
  the one place the rule is stated as code, and a new exception requires changing that test in
  review.
- This record amends ADR-0037 on how hosts reach the engine only; what the engine is and does
  stays as ADR-0037 decided.

### Worked scenarios

| Situation | Result |
|---|---|
| A host imports the engine by its package name | Allowed |
| A host imports a path below the package, such as a provider adapter | The boundary test fails |
| The agent worker asks the engine for a Claude Code runtime by name | Allowed |
| The web server asks the engine for an agent runtime | The boundary test fails |
| A host needs a different provider | It names the other kind to the engine; no host file imports an adapter |

## Alternatives Considered

### Option A — Allow subpath imports for convenience
- **Pros:** fewer wrappers in the engine.
- **Cons:** the provider becomes public; hosts begin to branch on it, which ADR-0007 forbids.
- **Why not:** that is the coupling the SDK exists to remove.

### Option B — Rely on review and convention
- **Pros:** no test to maintain.
- **Cons:** the owner asked for it to be impossible, not discouraged.
- **Why not:** a rule that is not checked erodes.

## Consequences

**Positive:**
- A provider or runtime can change inside the engine without touching a host.
- A breach fails the build.

**Negative:**
- Anything a host needs from inside the engine has to become part of the engine's public surface.

## References

- [[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]] (amended)
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- The boundary test in `scripts/package-boundaries.test.ts` (informative; it is the executable form of this record).
