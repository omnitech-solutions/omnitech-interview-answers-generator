---
id: ADR-0009
title: Keep candidate documents in the Interview product
status: Accepted
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: 2026-10-02
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [interview, documents, privacy, artifacts, ai]
related_briefs: []
related_research: [concepts/interview-domain-model, references/ai-execution-boundaries]
governs:
  - domain: interview-documents
    rule: "Candidate documents, templates, revisions, and exports are owned by the Interview product."
    scope: products/interview
    handle: ADR-0009/interview-owns-documents
    provenance: authored
  - domain: interview-documents
    rule: "Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person."
    scope: products/interview and platform artifacts
    handle: ADR-0009/member-private-documents
    provenance: authored
  - domain: interview-documents
    rule: "Document generation uses one structured AiExecutionGateway call against a template revision and an immutable candidate-profile revision."
    scope: products/interview generation
    handle: ADR-0009/structured-document-generation
    provenance: authored
  - domain: interview-documents
    rule: "Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders."
    scope: products/interview revisions and exports
    handle: ADR-0009/immutable-document-revisions
    provenance: authored
---

# ADR-0009 — Keep candidate documents in the Interview product

## Context

Interview Studio already owns candidacies, interviews, and immutable candidate-profile revisions. The source studio creates tailored resumes, cover letters, and interview preparation documents from those inputs. A separate product would cross the product boundary to reconstruct the same context. The current candidacy does not store job-description text, and `platform.artifacts` records a payload reference without itself supplying a binary storage service; both gaps must be closed before the design's autofill and downloads can work. Existing candidacy and interview rows have tenant policy but are not member-private, while candidate profiles are private to the actor. Documents contain private candidate material and must meet OBJ-5.

## Decision

Interview owns document templates, immutable template revisions, documents, immutable document revisions, and exports in its schema. Templates carry kind, format, name, and nullable owner; revisions bind source artifact, extracted field contract, and generation instructions. Documents carry title, status, template revision, candidate-profile revision, and optional candidacy and interview; general documents have neither. Document revisions store resolved flat values, generated/edited provenance, validation state, and normalized AI usage. Exports bind a revision, format, and artifact. Candidacy context includes stored job-description text; an interview must belong to the selected candidacy. A candidacy is eligible only when its `candidatePersonId` equals the actor's `member_people.personId` in that tenant. Every document operation rechecks that binding and the private profile owner.

Private Interview document rows use forced row-level security scoped by tenant and actor, in addition to owner checks in the API. Interview source and export artifacts gain actor-scoped row security and a relation check against the member's template or document; upload and download require matching tenant, actor, product, artifact type, and owning relation. Opaque payload references are never public download paths. Ordinary members receive a narrow Documents write capability rather than broad `interview.write` or `artifact.write`; the trusted server creates their artifacts with the authenticated actor as owner. A built-in template is a read-only tenant catalog row with no member owner and a tenant-local built-in source artifact with no member owner. Artifact ownership may be null only for that controlled built-in type; only trusted provisioning writes it. A member duplicate creates a private template revision and member-owned source artifact. Existing non-Documents artifact behavior stays governed by its current contracts.

Platform storage owns durable, size-bounded artifact payload bytes in the existing PostgreSQL cluster, related to `platform.artifacts` by a same-tenant reference; payload rows carry tenant identity and forced row-level security. The artifact row remains the metadata and access entrypoint. This closes the current payload-reference gap without another external storage service. The Interview product accesses payloads only through a narrow platform-storage interface; no product reads its internal tables.

Generation is one structured call through `AiExecutionGateway` using a configured profile. Template instructions, profile text, and employer material are untrusted data; server-owned field keys and candidacy values remain authoritative. Structured output is checked against the template contract before saving. Candidacy-owned fields come from candidacy data, while missing profile-only values remain available for manual entry. Validation records missing or invalid fields without inventing content. Each revision stores all resolved values, including candidacy-derived values, so later context edits cannot change an older preview or export. An edit, targeted regeneration, or restore creates a new immutable revision with a stale-revision guard; older revisions remain readable but cannot be mutated. Preview and DOCX or Markdown export render the selected revision through a shared field contract. Each exported file is retained as a platform artifact and linked to the revision that produced it. A cancelled first generation leaves no document. The feature has no LangGraph run, node tree, or trace screen.

Uploaded DOCX files are untrusted. Extraction has bounded compressed and expanded size and entry count, rejects traversal and external fetches, and never executes macros or embedded objects. Preview content is escaped and inert; exported filenames and download headers are safe. Malicious and oversized files must be rejected before a source revision is committed.

## Alternatives Considered

### Separate Documents product

It could serve other products later, but would need cross-product APIs for candidacy, interview, and profile data now. That adds a lifecycle and authorization boundary without a current second owner.

### Keep the standalone DOCX studio and embed its workflow

It preserves its existing screens, but duplicates candidate data and retains LangGraph orchestration and traces that the new flow does not need. Its parsing and rendering behavior remains useful as a reference.

### Store only final files

It reduces the number of records, but loses field-level correction, reliable preview, and provenance of the profile and template revision used for an export.

## Consequences

- The Interview schema and private API gain the five document entities. Foreign keys and authorization must preserve tenant, member, candidacy, interview, template, and profile consistency.
- The platform artifact boundary gains payload storage and a controlled ownerless built-in type. It must preserve unrelated artifact behavior while refusing same-tenant, different-member access to private Interview files.
- The candidacy contract gains job-description content so autofill has a durable source; existing candidacies may have no description.
- The UI can list document and export history from immutable revisions rather than workflow traces. Concurrent edits need a stale-revision guard.
- DOCX and Markdown extraction, preview, and export must be tested against actual files, including split DOCX placeholders, hostile inputs, and missing or invalid values. Private prompts and output remain absent from default logs.

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[research/concepts/interview-domain-model]]
- [[research/references/ai-execution-boundaries]]
- [Interview Documents design](https://claude.ai/design/p/59731b8d-4cb4-4525-9c2c-f3831838932d?file=Interview+Documents.dc.html)
