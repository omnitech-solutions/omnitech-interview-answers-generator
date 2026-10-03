---
id: ADR-0015
title: "Validate owned document batches and measure grouping"
status: Proposed
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0010]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [interview, documents, generation, grounding, performance]
related_briefs: []
related_research: [references/ai-execution-boundaries]
governs:
  - domain: interview-documents
    rule: "Each model batch owns a disjoint, contiguous set of template fields and must return exactly those keys with string values before its result can enter progress or a document."
    scope: products/interview/src/backend/documents
    handle: ADR-0015/exact-owned-batches
    provenance: authored
  - domain: interview-documents
    rule: "Direct-source candidate, candidacy, and interview values remain authoritative; missing facts stay blank, while generated prose is a draft and never updates source preferences or profile facts."
    scope: products/interview/src/backend/documents
    handle: ADR-0015/source-facts-own-authority
    provenance: authored
  - domain: interview-documents
    rule: "A generation binds its owner, selected target, template and profile revisions, source selection, requested fields, and base document revision before model work begins."
    scope: products/interview/src/backend/documents
    handle: ADR-0015/immutable-generation-identity
    provenance: authored
  - domain: interview-documents
    rule: "Only a complete, structurally validated field snapshot may be saved; progress remains provisional, and a stale revision or repeated generation identity cannot publish a second revision."
    scope: products/interview document API and repository
    handle: ADR-0015/complete-revision-publish
    provenance: authored
  - domain: interview-documents
    rule: "Grouping is selected from same-input, same-machine trials of one, three, and five model groups that record visible-field time, total time, calls, tokens, cost, and failures."
    scope: products/interview document generation and evaluation
    handle: ADR-0015/measured-document-grouping
    provenance: authored
---

# ADR-0015 — Validate owned document batches and measure grouping

## Context

ADR-0009 makes Interview the owner of private documents, immutable template and candidate-profile revisions, and immutable document revisions. ADR-0010 already provides capped, contiguous parallel model calls, direct-source field resolution, provisional plan and batch events, reader cancellation, and save only after the calls complete. The current generator accepts a missing key as an empty value and permits a batch response to name another batch's candidate-profile key. This loses the distinction between an unsupported fact intentionally left blank and a structurally incomplete response. The API and repository already use selection uniqueness and a base-revision compare-and-set; those protect the saved winner but do not identify a model attempt across retries. No same-input one/three/five-group measurement in this cycle establishes a better default.

## Decision

Keep orchestration within Interview's existing document generation, API, and repository boundaries. A generation identity binds the tenant and actor, selected model target, template revision, immutable candidate-profile revision, selected candidacy and interview, requested field set, and, for regeneration, the base document revision. The identity is fixed before model work and accompanies progress and final publication. It is used to recognize a replay of the same committed request; a different request against an older base revision conflicts. This adds no general workflow engine or durable partial-batch job.

The server assigns each model batch a disjoint, contiguous field set in template order. A batch is accepted and shown in progress only after its response contains exactly its assigned keys, each a string; an omitted key is a malformed response, while an explicit empty string remains the valid way to say evidence is missing. A batch may not write another batch's key or any direct-source key. Before save, the server checks the complete template key set and value types and resolves the final snapshot from validated batches plus server-owned fields. Existing field-level validation may still mark a structurally complete revision `invalid` for a person to correct; structural completeness does not assert that every required fact exists.

Candidate-profile, candidacy, and interview facts copied from approved source revisions are authoritative for their assigned fields and never overwritten by model output. An absent approved fact remains blank. Generated technical explanation and suggested interpretation may fill model-owned fields as provisional draft prose, but neither updates nor satisfies source candidate preferences, profile facts, or direct-source fields. A user may review and edit the draft into a later immutable revision; model text alone is not evidence that a candidate claim is true. The generation instructions continue to ask for only supported claims and must not present unsupported text as verified candidate evidence.

Progress remains the existing plan, validated batch, then saved-document stream. Batch values are provisional until one complete document revision commits. The first generation keeps ADR-0009's unique selection boundary, and regeneration keeps its base-revision compare-and-set. A replay of a committed generation identity returns its committed result without publishing another revision; an in-flight duplicate may be refused as ADR-0010 permits. A stale base, cancelled reader, incomplete batch, or failed call cannot save a partial revision. Repeated model work before a result commits may still incur bounded cost under ADR-0010's call and retry limits; idempotency here guarantees publication, not a free provider retry.

Choose grouping from measurement rather than a guessed optimum. Run the same selected model, resume, template revision, candidate-profile/matrix revision, and machine for one, three, and five groups. Record time to first visible fixed field and first validated model field, total time to saved document, model calls, token use, cost when reported, and failures or cancellations; retain trial counts, provider version and unavailable metrics. Compare before and after the change on that workload. The chosen default must improve visible progress or completion without an unacceptable cost or failure increase, with the trade-off recorded; where live trials require unapproved spend or cannot run, retain the current bounded default and label the performance claim unobserved.

## Alternatives Considered

### Persist a resumable generation coordinator

- **Benefit:** A page reload could resume partial model batches and avoid some repeated calls.
- **Why not:** It adds job state, reconciliation, and a new lifecycle while ADR-0010 deliberately cancels work when its reader leaves. The observed gap is batch validation and revision publication, which the current boundaries can handle.

### Return to one model call per document

- **Benefit:** One response is simpler to validate and may cost less.
- **Why not:** It removes progressive model fields and reverses ADR-0010 without a same-workload comparison showing that it serves the user better.

### Keep permissive batch responses and improve the prompt

- **Benefit:** No contract change.
- **Why not:** A prompt cannot distinguish an omitted key from an intentional blank after the response is accepted, or prove exclusive ownership of fields.

## Consequences

**Positive:** Every displayed batch has a complete owned shape; final revisions retain direct-source authority, stale-revision protection, and one committed result per generation identity. Grouping changes have an explicit measurement basis.

**Negative:** A provider response omitting any assigned key now fails rather than producing a blank. Retry attempts may still spend model time before one result commits. Prose remains a draft that needs human judgment for factual claims.

**Follow-on:** Development must test missing and cross-batch keys, deliberate blanks, cancellation and duplicate races, immutable source selection, stale revision rejection, and the same-input one/three/five-group benchmark. Unavailable token or cost data and unobserved live-model behavior must be recorded, not inferred.

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]]
- [[adrs/ADR-0010-write-documents-in-a-few-parallel-calls-on-any-lan]]
- [[adrs/ADR-0014-use-worker-owned-agent-sessions-with-one-terminal]]
- [[research/references/ai-execution-boundaries]]
