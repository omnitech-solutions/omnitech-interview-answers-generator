---
id: ADR-0011
title: Keep Active Session data private to the actor and enforce locality before dispatch
status: Proposed
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, privacy, row-security, locality, retention, interview]
related_briefs: []
related_research: [concepts/interview-domain-model, references/ai-execution-boundaries]
governs:
  - domain: active-session-privacy
    rule: "Active Session tables are owned by products/interview and carry tenant and owner ids under forced row security that binds both."
    scope: products/interview active-session persistence
    handle: ADR-0011/actor-private-session-rows
    provenance: authored
  - domain: active-session-privacy
    rule: "Every table that references a session does so by tenant, owner and session id."
    scope: products/interview active-session persistence
    handle: ADR-0011/composite-owner-references
    provenance: authored
  - domain: active-session-privacy
    rule: "A session may link an interview, candidacy, profile revision, Workspace draft, agent job or artifact only after the database confirms the same tenant and owner."
    scope: products/interview active-session persistence and publication
    handle: ADR-0011/linked-resource-authorization
    provenance: authored
  - domain: active-session-privacy
    rule: "Every session read path opens an actor-scoped transaction for the session's owner."
    scope: session streams, downloads, context assembly, job results and artifact discovery
    handle: ADR-0011/owner-checked-read-paths
    provenance: authored
  - domain: active-session-privacy
    rule: "Rows of ai.agent_jobs and their child tables are readable and cancellable only by the job's user or the agent worker."
    scope: packages/platform-storage ai schema and agent-job repository
    handle: ADR-0011/actor-guarded-agent-jobs
    provenance: authored
  - domain: active-session-privacy
    rule: "Session artifact types are named in the artifact owner-only policies in the same migration that introduces them."
    scope: platform.artifacts policies
    handle: ADR-0011/private-session-artifact-types
    provenance: authored
  - domain: active-session-privacy
    rule: "The session worker claims sessions across tenants through one setting, one owning file and lease and fence columns only."
    scope: app.session_worker policy and its single owning file
    handle: ADR-0011/session-claim-policy
    provenance: authored
  - domain: active-session-privacy
    rule: "Final transcript text lives only in session observation rows, and selected screenshots only as owner-private artifacts with payloads."
    scope: session content storage
    handle: ADR-0011/content-storage-of-record
    provenance: authored
  - domain: active-session-privacy
    rule: "Raw audio is held only in a bounded companion memory buffer and is never sent, stored or logged."
    scope: apps/capture-companion and active-session-contracts
    handle: ADR-0011/raw-audio-never-persisted
    provenance: authored
  - domain: active-session-privacy
    rule: "Ingest refuses over-limit content with a content-free outcome and writes nothing."
    scope: active-session-contracts constants and ingest routes
    handle: ADR-0011/bounded-ingest
    provenance: authored
  - domain: active-session-privacy
    rule: "Retention is one of delete at end, thirty days or until deleted, defaults to delete at end and is chosen only by the owner."
    scope: session start and retention control
    handle: ADR-0011/retention-modes
    provenance: authored
  - domain: active-session-privacy
    rule: "One idempotent purge deletes all session content, job payloads included, and records a content-free receipt."
    scope: products/interview session purge and the worker session loop
    handle: ADR-0011/complete-session-purge
    provenance: authored
  - domain: active-session-privacy
    rule: "Traces and logs hold ids, revisions, profiles, durations, outcomes, byte counts and validation paths, never content or content hashes."
    scope: session core, processor and routes
    handle: ADR-0011/id-only-traces
    provenance: authored
  - domain: active-session-privacy
    rule: "Captured text, images and pre-loaded role text are untrusted data that cannot grant tools, change policy, request secrets or override allowed actions."
    scope: session processor and interview policy
    handle: ADR-0011/captured-input-untrusted
    provenance: authored
  - domain: active-session-locality
    rule: "Every AI profile declares its locality in host configuration, and a missing or unknown value is treated as remote."
    scope: packages/ai-runtime profiles and apps/web profile configuration
    handle: ADR-0011/declared-profile-locality
    provenance: authored
  - domain: active-session-locality
    rule: "A session records its processing policy at start, and only the session row decides it."
    scope: active_sessions and the processor
    handle: ADR-0011/session-processing-policy
    provenance: authored
  - domain: active-session-locality
    rule: "A device-only session uses only device-locality profiles, enforced at profile resolution and again before dispatch, with no fallback."
    scope: AiExecutionGateway and the session processor
    handle: ADR-0011/device-only-enforced-twice
    provenance: authored
  - domain: active-session-locality
    rule: "A device-only session refuses a stage that has no device-locality implementation instead of degrading it."
    scope: transcription, image interpretation, coding inference and agent jobs
    handle: ADR-0011/refuse-not-degrade
    provenance: authored
  - domain: active-session-locality
    rule: "A session may tighten its processing policy to device-only but never loosen it."
    scope: session control
    handle: ADR-0011/tighten-only-locality
    provenance: authored
  - domain: active-session-rehearsal
    rule: "A session never writes a Rehearsal scorecard, and live assistance in a strict rehearsal is disabled."
    scope: session start and the Rehearsal flow
    handle: ADR-0011/no-second-scorecard
    provenance: authored
  - domain: active-session-rehearsal
    rule: "In a non-strict rehearsal each shown assistance draft is counted as a hint at the existing hint cost."
    scope: session actions and the Rehearsal scorecard
    handle: ADR-0011/assistance-counts-as-hints
    provenance: authored
---

# ADR-0011 — Keep Active Session data private to the actor and enforce locality before dispatch

## Context

ADR-0010 fixes where the Active Session processor runs and how it talks to the companion, and defers private data, retention, locality and untrusted input to this decision. A transcript of the candidate and the interviewer, and screenshots of their screen, are the most private data Interview Studio holds; OBJ-5 requires them to stay inside the owner's view, and OBJ-3 requires a rehearsal to keep one scorecard.

The code facts that shape the decision, verified in this branch:

- Interview tables and `ai.agent_jobs` with its child tables are scoped by tenant only; a teammate in the same tenant can read them. Foreign keys are checked without row security, so a session could be pointed at another member's resource.
- The Documents migration is the precedent: owner-scoped forced policies, composite tenant and owner keys, trigger-based linked-resource checks, and restrictive `platform.artifacts` policies that list only the three document types. Any other artifact type is discoverable by the whole tenant.
- Artifact payload rows are owner-only bytea up to 10 MiB. The assistant draft table uses text keys, so a UUID session table cannot reference it by foreign key.
- `AiProfile` has no locality. The word "local" in profiles and the picker is display metadata, and locality inferred from a base-URL pattern is unreliable. The vendored on-device model reaches the server through a relay to an open browser tab and does not pass through `AiExecutionGateway`; it is text-only with an 8k window and has no speech, vision or OCR.
- `ai.agent_jobs` payload rows have an expiry that no process deletes, and there is no retention or purge job anywhere. `ai.agent_jobs` has an unused text `session_id`; this decision does not use it, so ADR-0010's rule that a job never carries session identity holds.
- Rehearsal writes one scorecard at the end of a run, from the client, and prices a hint (`REVEAL_COST`).

Binding limits: ADR-0002 to ADR-0010, exactly one new package and one new app, no new service or storage engine, `omnitech-assistant` unchanged. ADR-0004 to ADR-0007 are still Proposed and this decision depends on them.

## Decision

**Ownership and row security.** The three session records, `active_sessions`, `session_observations` and `session_actions`, are product-owned tables in the interview schema with tenant and owner ids. Forced row security binds tenant and owner for every command, as in Documents, with check equal to using. Children reference `(tenant, owner, session)` so a child can never name another owner's session. The session row holds status, lease, fence, retention, processing policy and a start-time snapshot of the allowed sources; the fence and lease are columns of the session row (ADR-0010). Observation and action rows hold content and are the only places it lives.

**Linked resources.** A session may link an interview, candidacy, candidate-profile revision, Workspace draft, agent job or artifact only when the database confirms that tenant, owner, product and, for artifacts, type match; the check is a database trigger on insert, in the Documents manner, not a foreign key. Draft ids are text keys, so the check reads the owner's draft row in the same tenant transaction, and the publish port repeats it. Linked ids are immutable after insert. A candidacy qualifies only through the actor's own person record, as in ADR-0009. The security suite tests a foreign actor's id and a nonexistent id for each link kind.

**Read paths.** Streams, downloads, context assembly, job results and artifact discovery each open a tenant-and-actor transaction for the session owner and read only owner-scoped tables. No path calls an owner-blind agent-job read for a session.

**Agent jobs.** The platform, not the product, owns the actor guard: a restrictive policy on `ai.agent_jobs` and its child tables lets only the job's user, or the agent worker setting, read, update or cancel a row. The agent-job repository therefore carries the actor on every read, event stream and cancellation, and the dev module migrates every existing caller in the same change. A session action references a job by id; the job carries no session id and a failed link check refuses the action.

**Artifacts.** Screenshots are artifacts of a session type and the session type list is named in the restrictive owner-only select, insert, update and delete policies in the migration that introduces it; update is immutable and delete is allowed only on the purge path, which sets a transaction-local setting that one module owns. A same-tenant non-owner artifact listing returns no session artifact, and that is tested. The type list has one definition mirrored in code and tested for equality with the policy.

**Worker claim.** The worker finds sessions across tenants through one new setting, `app.session_worker`, with one owning file named in the tenant-context-boundary allowlist (ADR-0005). Its policy is limited to the session table and column privileges limit it to lease and fence columns; it returns tenant, owner and session ids only and cannot read observations or actions. It runs as the existing application role and never as an owner or BYPASSRLS role. After the claim every read and write is tenant-and-actor scoped (ADR-0010). Purge sweeps use the same claim.

**Content storage.** Final transcript text lives only in observation rows; interim text is never stored. A selected screenshot is stored once as a compressed image artifact with its payload, keyed to the session by content digest so a resent frame returns the original acknowledgement, and linked from its observation by tenant and artifact id. The server validates type and size from headers and never decodes the image content. No other row holds frame bytes or transcript text. Derived context and summaries are session content and are purge targets.

**Raw audio.** Raw audio exists only in the companion's memory, bounded in time and bytes, and is dropped on pause, stop and credential expiry. The wire contract has no audio kind, and this decision does not allow retaining audio; allowing it needs an amendment and a new contract kind.

**Bounds.** `active-session-contracts` carries hard maxima for observation text, screenshot size, envelope size, observations and screenshots per session, ingest rate and session duration, and one active session per owner. Over a limit the route refuses with a code and writes nothing; the values are contract constants, changed only by amendment of this decision.

**Retention and purge.** The owner chooses delete at end, thirty days or until deleted when starting a session; the default is delete at end, and a later change may only shorten retention. One purge module deletes in a tenant-and-actor transaction per session: it marks the session purging (refusing ingest and dispatch, cancelling jobs, revoking the credential), deletes screenshot artifacts so payloads cascade, deletes observations, actions, derived context and session-created Workspace drafts, deletes the prompt and result payloads of the jobs its actions name, and leaves a tombstone and a receipt. A draft the owner promoted or exported to a Document is outside the purge, and the UI says so. It runs from the worker's session loop on end, on owner delete, and in a periodic sweep of sessions past their retention; a crash resumes in the next sweep, and a session is purged only when a final check finds zero content rows. The receipt holds ids, mode, outcome and counts only. A test enumerates every table with a session reference and fails if one is not purged. Backups are outside this decision and the receipt text says deleted rows persist until backup rotation.

**Traces.** Traces and logs hold ids, revisions, fence, profile and locality decision, durations, outcomes, byte counts and validation paths. A canary string passed through ingest, dispatch, failure and purge must be absent from every collected trace and log line.

**Untrusted input.** Captured text, screen text, images and any pre-loaded role description are observation data only. Prompts carry them in labelled blocks outside policy text, and model output is parsed against a closed schema that rejects tool, locality, privacy and retention fields and records a suppression by ids. Together with ADR-0010's tool-free fast path, captured content cannot select a profile, a tool, a retention mode or a recipient. Fixtures are synthetic and a test scans them for real names, employers and compensation figures.

**Locality.** Locality is declared on each AI profile (device, private-network or remote) only by host configuration; a missing or unknown value is remote, and it is never inferred from a URL. Private-network does not satisfy device-only unless the operator declares it device. The vendored on-device model joins the gateway as a device profile, or its relay is wrapped by the same check, so it is not a bypass. A session records its processing policy, `device-only` or `permitted-remote`, at start; the processor derives each request's policy from the session row and never from ingest or model content. `AiExecutionGateway` rejects a non-device profile for a device-only request at resolution and again inside each method just before dispatch; an unmet policy is a typed, non-retryable `policy-refused` outcome naming ids only, never a fallback. Cancellation stays allowed.

**Locality by stage.** In device-only mode: transcription runs only in the companion with OS on-device recognition and a visible capability check, and a failed check turns transcription off with a visible refusal; image interpretation is refused because no device profile can read images, so screenshots may be stored but are not interpreted; answer generation uses only a device profile and a prompt over its context window is refused, not truncated or sent elsewhere; coding inference and agent-job dispatch are refused; code-runner execution is refused unless the host declares the runner device-local. Storing content in the owner's tenant database is not model egress and stays allowed in both modes. A session may tighten to device-only, flipping status first, but never loosen, since content already sent cannot be recalled. Studio shows the policy and the profile used per stage.

**Rehearsal.** A session in rehearsal mode never writes `rehearsal_sessions`; the existing Rehearsal flow stays the only scorecard writer. A strict timed rehearsal disables live assistance at start. In a non-strict rehearsal each shown assistance draft is an action that counts as a hint at the existing cost, which the Rehearsal flow reads from the owner's own session when it ends; the reveal cap and de-duplication change is a dev-module task.

**Migrations.** New migrations follow `20261003040000` in the single Drizzle stream: one for the session tables, triggers and forced policies, one for the platform artifact and agent-job policies, and one for the worker claim policy. The migration, schema and boundary tests that count tables and settings are updated with them.

## Alternatives Considered

### Option A — Store transcripts as artifacts
- **Pros:** reuses the artifact path.
- **Cons:** a row per segment; artifact listing becomes the discovery surface.
- **Why not:** transcripts need ordering and dedup, so only large blobs use artifacts.

### Option B — Generic `platform` session tables or reuse `assistant` tables
- **Pros:** shared across products.
- **Cons:** puts Interview semantics in the platform or in the unchanged assistant.
- **Why not:** ADR-0004 and the book Constraint.

### Option C — Service-level job owner check only
- **Pros:** no platform migration.
- **Cons:** not enforced by the database; a forgotten caller leaks results.
- **Why not:** the goal requires cross-user refusal on every path, and the policy already exists as a model in Documents.

### Option D — Locality as a session flag or URL pattern only
- **Pros:** no profile change.
- **Cons:** a mislabelled or relayed model still egresses.
- **Why not:** locality must be tied to what a profile is and checked at dispatch.

### Option E — Sweep-only purge, or retain raw audio on request
- **Pros:** simpler, or higher fidelity.
- **Cons:** delayed deletion; audio is the most sensitive capture.
- **Why not:** delete at end needs a prompt, provable purge, and no use case justifies audio.

## Consequences

**Positive:**
- Each read path, link, claim and purge has a database-level refusal that tests can prove (OBJ-5).
- Device-only is a guarantee with a refusal outcome rather than a label, and the on-device relay no longer bypasses the gateway.
- Rehearsal keeps one scorecard (OBJ-3), and the pattern serves another product's sessions (OBJ-6).

**Negative:**
- The `ai.agent_jobs` guard changes every existing job caller to pass an actor; a missed caller sees no rows. This is a platform change that warrants the ADR-0002 scope checkpoint.
- Device-only answers are limited to a text-only 8k model, so coding, vision and agent assistance are unavailable there.
- Screenshot bytea in the primary cluster adds bloat after purge; the caps bound it.
- One more cross-tenant surface, `app.session_worker`, needs a column-level test.
- The purge does not cover backups.

**Follow-on work:**
- Numeric limits, the hint cap and dedupe change, the code-runner device-local declaration, local OCR, account-deletion cascade and a general sweep of expired job payloads are dev-module decisions or later amendments.
- Credential renewal and the per-dereference actor checks deferred by ADR-0010 are met here by read-path and link rules.
- Same-tenant cross-user, locality-egress and injection evidence are produced by the dev loops.

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]]
- [[adrs/ADR-0010-host-the-active-session-processor-in-the-agent-worker]]
- [[research/concepts/interview-domain-model]]
- [[research/references/ai-execution-boundaries]]
