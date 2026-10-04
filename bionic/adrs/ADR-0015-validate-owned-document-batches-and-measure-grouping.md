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
    rule: "Each model batch owns a disjoint, contiguous set of model-filled template fields and must return exactly those keys with string values before its result enters progress or a document."
    scope: products/interview/src/backend/documents
    handle: ADR-0015/exact-owned-batches
    provenance: authored
  - domain: interview-documents
    rule: "Direct-source candidate, candidacy, and interview values remain authoritative; missing facts stay blank, while generated prose is a draft and never updates source preferences or profile facts."
    scope: products/interview/src/backend/documents
    handle: ADR-0015/source-facts-own-authority
    provenance: authored
  - domain: interview-documents
    rule: "A keyed generation reserves its owner, selected inputs, and captured source digest before model work; legacy unkeyed requests retain existing selection and revision guards."
    scope: products/interview/src/backend/documents
    handle: ADR-0015/immutable-generation-identity
    provenance: authored
  - domain: interview-documents
    rule: "Only a complete, structurally validated field snapshot may be saved; progress remains provisional, and a stale revision or repeated request key cannot publish a second revision."
    scope: products/interview document API and repository
    handle: ADR-0015/complete-revision-publish
    provenance: authored
  - domain: interview-documents
    rule: "Model-owned prose remains visibly unverified until candidate confirmation creates an immutable confirmed revision; edits, regeneration, and restore reset confirmation."
    scope: products/interview document preview, revision, and export
    handle: ADR-0015/unverified-claims-remain-drafts
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

Keep orchestration within Interview's existing document generation, API, and repository boundaries. The server assigns every attempt an identity; a new client may also supply an optional retry key outside the existing strict request bodies. Reusing that key requests a retry, while a new key is a new intentional request even when inputs appear identical. Existing unkeyed callers remain valid and retain their current selection uniqueness and base-revision guards, but receive no cross-request replay guarantee. Every new document revision, keyed or unkeyed, records a digest of the exact mutable source values captured for its generation; a source-refresh revision replaces that digest with one for the refreshed values. Before model work, a keyed request durably reserves its tenant, actor, document title, target, template revision, immutable candidate-profile revision, selected candidacy and interview, requested field set, base revision when present, and the captured source digest. The reservation contains no redundant source text. A failed or cancelled keyed attempt can retry only while the current source digest matches its reservation; changed source data requires a new request and explicit source refresh. The committed result reference joins the reservation atomically with the document revision. This is a narrow idempotency record, not a durable partial-batch job or general workflow engine.

The server assigns each model batch a disjoint, contiguous set of model-filled fields in template order. A batch is accepted and shown in progress only after its response contains exactly its assigned keys, each a string; an omitted key is a malformed response, while an explicit empty string remains the valid way to say evidence is missing. A batch may not write another batch's key or any direct-source key. First generation assembles all template keys from validated batches and server-owned fields. Targeted regeneration starts from the pinned base revision and replaces only the requested model-owned keys; every other value, including edited and direct-source values, remains as it was in that base revision. Before targeted model work, current candidacy and interview source digests must match the digest recorded with the base revision; if they differ, or a legacy base lacks a trustworthy digest, regeneration refuses and directs the user to an explicit source-refresh revision that updates direct-source values and the digest together. This keeps the model prompt and preserved fields on one coherent source snapshot. Before save, the server checks the complete template key set and value types. Existing field-level validation may still mark a structurally complete revision `invalid` for a person to correct; structural completeness does not assert that every required fact exists.

Candidate-profile facts from its immutable revision, and candidacy and interview facts captured from approved source data, are authoritative for their assigned fields and never overwritten by model output. An absent approved fact remains blank. Generated technical explanation and suggested interpretation may fill model-owned fields, but neither updates nor satisfies source candidate preferences, profile facts, or direct-source fields. Field validation's existing `ready`/`invalid` status remains about shape and required values only; a separate revision-wide `unverified`/`confirmed` state records whether the candidate reviewed all model-owned prose in that exact immutable revision. Generation starts `unverified`. Explicit candidate confirmation creates a new immutable revision with unchanged values and `confirmed`; any later edit, regeneration, source refresh, or restore creates an `unverified` revision. Preview shows this state. Unverified or invalid revisions may export only with a visible draft label in the rendered output; an unlabelled final export requires `confirmed` and every field `ready`. Model assertions, template instructions, and employer text never certify themselves. The generation instructions continue to ask for only supported claims and must not present unsupported text as verified candidate evidence.

Progress remains the existing plan, validated batch, then saved-document stream. Batch values are provisional until one complete document revision commits. After tenant, actor, and document authorization, a keyed lookup precedes stale-revision rejection: a committed matching explicit-input binding returns its stored revision without rereading mutable sources, while a key reused with different explicit inputs conflicts. An uncommitted matching reservation may resume only with an unchanged source digest; an in-flight duplicate may be refused as ADR-0010 permits. A new key or unkeyed request then faces ADR-0009's first-generation selection uniqueness or regeneration's base-revision compare-and-set. A stale base, cancelled reader, incomplete batch, or failed call cannot save a partial revision. Repeated model work before a result commits may still incur bounded cost under ADR-0010's call and retry limits; keyed idempotency guarantees publication, not a free provider retry.

Choose grouping from measurement rather than a guessed optimum. For each authorized Codex and Claude target, run at least ten paired trials for the current configured default and for each candidate of one, three, and five groups on the same resume, template revision, candidate-profile/matrix revision, target version, and machine. The primary endpoint is median time until the first validated model field is actually visible in the browser preview; server validation time and first visible fixed field are separate diagnostics. Record total time to saved document, model calls, tokens, cost when reported, failures or cancellations, and p95 total time. Predeclared choice: change the default only when a candidate has a strictly lower median primary endpoint than the measured current default, no higher failure count, no more than 20% higher median cost, and no more than 10% higher p95 total time; choose the eligible candidate with the lowest median primary endpoint, breaking ties by fewer calls. A target lacking cost data cannot justify a changed default until cost is measured. Compare before and after the change on that workload and retain all trials and unavailable metrics. Where live trials require unapproved spend or cannot run, retain the current bounded default and label performance for that target unobserved.

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
