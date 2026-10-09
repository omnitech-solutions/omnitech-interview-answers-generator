---
id: ADR-0036
title: "Project facts and scenario context through one standalone package, declared as data, with no retrieval database"
status: Deprecated
date: 2026-10-08
proposed_date: 2026-10-08
accepted_date: null
deprecated_date: 2026-10-08
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [projection, context, documents, experience-matrix, packages]
related_briefs: []
related_research: []
governs: []
---

# ADR-0036 — Project facts and scenario context through one standalone package, declared as data, with no retrieval database

## Context

A person's experience matrix and the context of one interview are turned into something else in
five places: the context the live assistant reads, briefing preparation, generated documents, coach
note sources and the views in the Context pane. An audit on 2026-10-08 found the same idea built
three times over: three functions that walk the matrix into facts, three that rank roles, three that
hash it. They disagree. The Context pane ranks roles with a different rule from the one the model
is given, so the view does not show what was read. Context is addressed whole in one path and by
sentence in another. Documents receive the whole matrix and keep only a digest, so no bullet can be
traced to the fact behind it and no requirement can be shown as covered or not. Every limit and
weight is a constant in code. Addresses are positional, so inserting a role moves every address after it.

The owner wants one capability that stands on its own, is usable outside the native app, serves the
live assistant and document generation alike, is driven by configuration and data, and builds only
what is needed. Nineteen related repositories and current practice were reviewed. A person's career
is a few hundred short facts, far below the size at which retrieval indexes pay for themselves; the
owner's own earlier attempt at retrieval for documents did not work and was removed.

## Decision

- One package owns the projection of facts and scenario context. It is pure: it depends on the
  contracts package only, has one public entrypoint, and uses no database, gateway or framework,
  so the server, the browser, the command line and other products can all call it.
- Every leaf of the matrix and every piece of scenario context is a fact with a stable address that
  does not change when its neighbours do, a revision and a content hash.
- Content has four modes, and a slot declares which it takes. Exact: a known field looked up by
  key and never written by a model. Ranked: evidence scored and chosen within a budget. Narrative:
  long text condensed and split into requirements. Manual: what the person typed, used as given.
- A projection is data: what it draws from, how it filters, groups, orders and limits, and the
  named fields it produces. It is validated when loaded, versioned and hashed. Its filters are a
  small closed set of operators; there is no expression language in configuration.
- Resolving is its own step, before any model call or document render. It returns, for every slot
  or requirement, exactly one state (covered, needs a choice, known but empty, no such fact, out of
  scope with a reason) together with the facts kept, the facts cut and why, and each fact's score
  in parts.
- Exact lookup is authoritative; ranking only suggests. A person's pin or exclusion outranks any
  score, and an accepted match is remembered as an alias, held as data.
- The budget is derived from the context window the model's runtime reports, reserving room for
  the reply first and cutting in a fixed, stated order. A fact marked as required that does not
  fit is an error, never a silent omission.
- One resolved result feeds the model's context, a document's fields and the views a person
  inspects, so what is shown is what was read. The live assistant, briefing, document generation
  and the Context pane all take their facts, ranking and addresses from this package; their own
  walkers, rankers and hashers are removed.
- A claim in an answer or a document cites a fact from the set it was given; a citation outside
  that set is dropped by code. A generated document is checked back against the facts, each value
  marked exact, near or not found, before it can be exported.
- No retrieval database, embedding or vector index is added. Selection is exact lookup, word
  matching and the alias table. This is revisited only when a recorded set of cases shows required
  facts missed because of wording; the first step then is full-text search in the existing database.
- Selection is tested without a model, against cases that name the facts that must be chosen and
  those that must not.

The package keeps nothing. Aliases, pins, exclusions and coverage decisions stay in the Interview
product's own tables (ADR-0005), and each run's selection is recorded as ADR-0035 requires.

## Alternatives Considered

### Option A — A module inside the Interview product
- **Pros:** no new package; the smallest change; the audit's own first choice.
- **Cons:** other products, the command line and outside callers cannot use it without copying.
- **Why not:** the owner names more than one consumer and use outside the app, which is ADR-0002's
  condition for a new boundary.

### Option B — A retrieval database with embeddings
- **Pros:** matches by meaning when the wording differs.
- **Cons:** an embedding dependency, re-indexing on every edit, a ranking that cannot be explained
  fact by fact, and evaluation work to prove it helps.
- **Why not:** the corpus fits in one prompt many times over; no reviewed system of this size
  needed one, and the alias table answers the wording problem at this scale.

### Option C — A query or transformation language in configuration
- **Pros:** expressive; no code change for a new shape.
- **Cons:** configuration becomes code that is harder to validate, test and explain.
- **Why not:** a handful of operators covers the projections needed.

### Option D — Leave the three implementations and fix their disagreements
- **Pros:** no restructuring.
- **Cons:** they drift again; documents still cannot trace a value to a fact.
- **Why not:** the duplication is the defect.

## Consequences

**Positive:**
- The view of what the model read is the selection itself, for every path.
- A requirement's coverage and a document value's source become answerable.
- Limits and weights are data that can be changed and compared without a code change.
- One selection sized for a small on-device model and a large hosted one.

**Negative:**
- A new package, and a change that touches the live path, briefing, documents and the Context
  pane; it exceeds ADR-0002's size threshold and needs a scope checkpoint and staged delivery.
- Moving from positional to stable addresses invalidates stored pointers (pinned roles, coach note
  sources, proposal snapshots), which need a mapping.
- Word matching will miss some paraphrases until the alias table grows.

**Follow-on work:**
- Structured preferences and versioned interview context, which change stored shapes.
- The coverage, context-inspector, citation and pivot views, from library components.
- Server-side checking of coach note source pointers against the facts.

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0035-record-every-ai-interaction-with-its-content-in-dev]]
- Design brief: "Experience Matrix and Interview Context" (2026-10-08), sections "Kinds of content"
  and "What the research settled".
