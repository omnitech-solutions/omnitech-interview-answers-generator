---
id: ADR-0038
title: "Prepare raw information into attributable context, then resolve it deterministically, inside the AI engine"
status: Proposed
date: 2026-10-08
proposed_date: 2026-10-08
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [context, projection, engine, documents, experience-matrix]
related_briefs: []
related_research: []
governs: []
---

# ADR-0038 — Prepare raw information into attributable context, then resolve it deterministically, inside the AI engine

## Context

> **Body budget:** 174 lines — the decision is what goes in and what comes out, so it is shown on worked scenarios.

A person gives Interview Studio raw information: an experience matrix, pasted notes, a job
posting, preferences typed by hand. Five paths turn it into something a model or a document uses,
and they disagree. ADR-0036 decided to unify them in a pure package, and was rightly criticised as
open to interpretation: it did not say who reads raw documents, whether condensing is a model call,
what a configuration looks like, who gives a fact its identity, what the result is, or what a
citation proves. Two developers could build different things from it.

Comparisons of the current code show the disagreements are real. A query naming four technologies
picks one role on the server and another in the view, because one scores a match as yes or no and
the other counts. A query of "Go" is dropped by the server as too short. A proof point of 400
characters reaches the model and one of 401 does not, while the facts view shows both. Inserting a
role changes the address of every fact after it. A key containing `/` or `~` is encoded two ways.

The capability belongs in the AI engine (ADR-0037), so the assistant, Studio and document
generation share it. This record replaces ADR-0036.

## Decision

- There are two operations, and they are different in kind.

  | | Prepare | Resolve |
  |---|---|---|
  | Does | Takes authorised sources and a recipe; validates structured input; extracts from unstructured input; links every record to where it came from | Selects from a prepared result for one task, under a projection, a query and a budget |
  | May call a model | Yes, for unstructured input only | Never |
  | Repeatable | Its result is kept against the source, schema, recipe and extractor versions, and reused | Same prepared result, recipe, query, overrides and budget always give the same answer |
  | When | On import or edit | On every question, field or view |

- The product supplies a **recipe**: versioned, typed configuration, not code. It declares the
  sources accepted, the instructions for extracting from unstructured text, the output schema, how
  a record points to its source, the named projections and their selection rules, the required
  fields and what to do when one is missing, and the limits. A schema says a record has
  technologies and metrics; only the recipe says whether a sentence is the candidate's experience,
  an employer's requirement or advice. Selection uses a small closed set of operations. Where
  behaviour needs code, the recipe names a registered function; no expression language is invented.
- Whoever imports or stores a source gives each record its identity and keeps it. The resolver
  never infers identity from position. A content hash tracks what a record says, separately from
  which record it is. Addresses are encoded by one implementation.
- Content has four modes, and a slot declares its own: **exact** (a known field, looked up, never
  written by a model), **ranked** (evidence chosen within a budget), **narrative** (long text,
  prepared into requirements), **manual** (typed by the person, used as given).
- A record keeps its kind. An employer's requirement is never turned into a claim about the
  candidate.
- Resolving returns one result that every consumer reads:

  | Part | For |
  |---|---|
  | Validated records | Structured values for what comes next |
  | Evidence references | Source, revision, location, content hash |
  | Selected facts | Exactly what this operation was given |
  | Excluded facts, each with a reason | Budget, exclusion, relevance, scope |
  | A resolution per slot or requirement | Covered, needs a choice, known but empty, no such fact, out of scope |
  | Selection details | Recipe version, source revisions, budget, score in parts, a digest that reproduces it |

- "Covered" means candidate evidence of the right kind is selected for that requirement. A related
  source merely being present does not cover it.
- The model's input and the view a person inspects are drawn from the same result, including the
  exclusions. A person's pin or exclusion outranks any score; an accepted match is kept as an alias.
- The budget covers the whole request: instructions, tool definitions, history, images and the
  room kept for the reply. It comes from the capacity the runtime reports. If capacity is unknown,
  a configured conservative figure is used and the result says so. A required fact that does not
  fit is a failure, never a silent omission.
- A claim's citation is checked at three stated levels, and no more is claimed: that the cited
  record was in the selection; for an exact field, that the value is the record's value; for
  written narrative, a mark of exact, near or not found against the facts. None of these proves a
  claim is true.
- No retrieval database, embedding or vector index. Selection is exact lookup, word matching with
  one shared rule for splitting words, and the alias table. This is revisited only when recorded
  cases show required facts missed because of wording; full-text search in the host's database
  comes first.
- The five differences in the Context section are the first acceptance cases, and selection is
  tested without a model.

### Worked scenarios

**1. Importing a matrix that is already structured.** No model is called.

| In | Out |
|---|---|
| A matrix with two roles, each with technologies and a metric | Two role records and their facts, each with an identity assigned on import and a content hash |
| The same matrix with a role inserted first | The original facts keep their identities; one new role is added |
| A matrix with a field the schema does not declare | Refused, naming the field; nothing is dropped silently |

**2. Pasted notes and a job posting.** Extraction runs once and is kept.

Notes: "I built React screens that called Laravel APIs. I used NestJS for a separate reporting
service." The posting asks for NestJS and PostgreSQL.

| Information | Prepared as |
|---|---|
| React and Laravel | Candidate evidence, linked to the first sentence |
| NestJS reporting service | Candidate evidence, linked to the second sentence |
| NestJS, PostgreSQL in the posting | Employer requirements, linked to the posting |
| Candidate experience of PostgreSQL | Absent: the requirement resolves as "no such fact" |
| A percentage improvement | Absent: no metric is invented |
| "Led the migration" | Unsupported by these notes; not prepared |

**3. A live question.** "Which of these have you used in production: NestJS, Go, PostgreSQL?"
Nothing is extracted again; only resolving runs.

| Slot | Resolution | Detail |
|---|---|---|
| Company, role, stage | Covered, exact | Looked up; never ranked |
| NestJS | Covered | The reporting-service fact, selected |
| Go | No such fact | The two-letter term is matched, not dropped |
| PostgreSQL | No such fact | The posting's requirement is not offered as experience |
| Notice period | Known but empty | Asked for by the recipe, not yet given |
| Cut | One 600-character proof point | Reason: over the per-fact limit; shown in the inspector with that reason |

The model receives the selected facts; the inspector shows the same list and the same cut.

**4. A résumé field and a narrative paragraph.**

| Field | Mode | Result |
|---|---|---|
| Name, email, phone | Exact | Inserted from the profile; the model never sees a request to write them |
| Role title for this application | Exact | From the candidacy |
| Summary paragraph | Ranked evidence, then written | Each sentence cites the facts it used; "PostgreSQL expert" is marked not found and blocks export until resolved |

**5. A small on-device model.** The runtime reports 2,048 tokens.

| Budget | Outcome |
|---|---|
| Reply reserve and instructions taken first | About a thousand characters remain for evidence |
| Three required facts fit, six optional ones do not | Three selected; six excluded with reason "budget", in a stated order |
| A required fact alone exceeds what remains | Failure naming the fact; no partial context is sent |

## Alternatives Considered

### Option A — One operation that takes raw input and returns a prompt
- **Pros:** the simplest call.
- **Cons:** extraction would rerun on every spoken question, adding delay, cost and variation, and
  nothing could be inspected or reused.
- **Why not:** preparing once and resolving many times is the point.

### Option B — A pure resolver only, with preparation left to each product
- **Pros:** small; no model inside.
- **Cons:** every product rebuilds extraction, validation and provenance, differently.
- **Why not:** this is ADR-0036's gap.

### Option C — A retrieval database with embeddings
- **Pros:** matches by meaning.
- **Cons:** a dependency, re-indexing on every edit, a ranking that cannot be explained fact by fact.
- **Why not:** the corpus fits in a prompt many times over, and an earlier attempt was removed.

### Option D — A query language in the recipe
- **Pros:** expressive.
- **Cons:** configuration becomes code that is harder to validate and explain.
- **Why not:** a closed set of operations plus named functions covers the need.

## Consequences

**Positive:**
- What the model read and what the person is shown cannot differ.
- A requirement's coverage and a document value's source are answerable.
- Extraction cost is paid once per source, not per question.
- One selection serves a large hosted model and a small local one.

**Negative:**
- Stored positional addresses (pinned roles, coach note sources, proposal snapshots) must be
  mapped to assigned identities.
- Recipes are a new thing for a product to write and version.
- Word matching misses some paraphrases until aliases accumulate.
- A change across the live path, briefing, documents and the context view; staged, starting with
  the live answer and its inspector.

**Follow-on work:**
- Structured preferences and versioned interview context.
- The coverage, inspector, citation and pivot views.
- Recorded cases that name the facts that must and must not be selected.

## References

- [[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]]
- [[adrs/ADR-0036-project-facts-and-scenario-context-through-one-sta]] (replaced by this record)
- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- Design brief: "Experience Matrix and Interview Context" (2026-10-08).
- Comparisons of the current selection functions on synthetic inputs (2026-10-08): the five
  differences listed in Context. Informative; they describe today's code, not the proposed design.
