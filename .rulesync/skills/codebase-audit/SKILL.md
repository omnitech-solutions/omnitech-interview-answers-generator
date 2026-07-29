---
name: codebase-audit
description: Audit the real implementation seams before producing a platform or feature plan.
---

# Codebase audit

Inspect the current branch, uncommitted work, recent precedent, package graph,
runtime entrypoints, data ownership, APIs, UI triggers, tests, and operational
configuration. Translate request vocabulary into actual repository entities.

Produce a WORK CONTEXT block containing:

- product goal and non-goals;
- work type and affected concerns;
- layers marked EXISTS, PARTIAL, or MISSING;
- current entities and storage locations;
- frontend and backend entrypoints;
- trust and tenant boundaries;
- affected tests and verification commands;
- unresolved decisions that materially change architecture.

Derive answers from code before asking the user. Never invent a parallel model
when the repository already contains the relevant entity.
