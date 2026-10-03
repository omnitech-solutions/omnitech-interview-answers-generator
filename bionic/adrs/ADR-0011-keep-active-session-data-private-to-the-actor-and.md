---
id: ADR-0011
title: Keep Active Session data private to the actor and enforce locality before dispatch
status: Accepted
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: 2026-10-03
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0010]
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
    rule: "The database refuses changing a session's tenant, owner, rehearsal run id, strict flag, links or sources snapshot once set at start, except setting links, snapshot and credential to null while the session is purging."
    scope: active_sessions
    handle: ADR-0011/immutable-privacy-columns
    provenance: authored
  - domain: active-session-privacy
    rule: "The database refuses loosening the processing policy and lengthening retention."
    scope: active_sessions
    handle: ADR-0011/monotonic-privacy-columns
    provenance: authored
  - domain: active-session-privacy
    rule: "Job creation for a session verifies under a lock on the session row that it is active with a current fence, and cancellation fails closed on a job it cannot see."
    scope: session processor dispatch and agent-job repository
    handle: ADR-0011/job-creation-locked-to-session
    provenance: authored
  - domain: active-session-privacy
    rule: "A session job is resumed only after verifying under the session-row lock that its session, found through the action naming the job, is active."
    scope: agent-job repository resume path
    handle: ADR-0011/no-resume-after-end
    provenance: authored
  - domain: active-session-privacy
    rule: "Every session read path opens an actor-scoped transaction for the session owner."
    scope: session streams, downloads, context assembly, job results and artifact discovery
    handle: ADR-0011/owner-checked-read-paths
    provenance: authored
  - domain: active-session-privacy
    rule: "A job created by a session is visible and cancellable only by its creator and the agent worker."
    scope: packages/platform-storage ai schema and agent-job repositories
    handle: ADR-0011/private-session-jobs
    provenance: authored
  - domain: active-session-privacy
    rule: "A session action and its pre-generated job id are committed before the job is created, and job creation is idempotent on that id."
    scope: session processor dispatch
    handle: ADR-0011/action-before-job
    provenance: authored
  - domain: active-session-privacy
    rule: "Every session artifact type is covered by the artifact owner-only policies."
    scope: platform.artifacts policies
    handle: ADR-0011/private-session-artifact-types
    provenance: authored
  - domain: active-session-privacy
    rule: "The session worker claims sessions across tenants through one named setting with one owning file listed in the tenant-context-boundary test (scripts/tenant-context-boundary.test.ts)."
    scope: app.session_worker and its owning file
    handle: ADR-0011/session-claim-setting
    provenance: authored
  - domain: active-session-privacy
    rule: "Under the session claim setting the database permits changing only lease and fence columns."
    scope: active_sessions
    handle: ADR-0011/claim-writes-lease-and-fence-only
    provenance: authored
  - domain: active-session-privacy
    rule: "A named policy admits only the one session row whose credential hash is presented, after which access is tenant-and-actor scoped."
    scope: ingest credential resolution
    handle: ADR-0011/credential-lookup-policy
    provenance: authored
  - domain: active-session-privacy
    rule: "Deleting session artifacts requires a named setting with one owning file, plus matching owner and session artifact type."
    scope: platform.artifacts delete policy and the purge module
    handle: ADR-0011/purge-delete-setting
    provenance: authored
  - domain: active-session-privacy
    rule: "The session credential expires no later than the session duration cap and extends only by owner-initiated replacement."
    scope: session credential
    handle: ADR-0011/credential-lifetime-and-renewal
    provenance: authored
  - domain: active-session-privacy
    rule: "The session credential is revoked on end, purge, membership removal or owner request."
    scope: session credential
    handle: ADR-0011/credential-revocation
    provenance: authored
  - domain: active-session-privacy
    rule: "The session credential is at least 128 random bits, and a failed lookup gives one refusal whether the credential is unknown, expired or revoked."
    scope: session credential and ingest credential lookup
    handle: ADR-0011/credential-strength
    provenance: authored
  - domain: active-session-privacy
    rule: "The database refuses new observations, screenshot artifacts and published results for a session that is ended or purging."
    scope: session_observations, session_actions and session artifacts
    handle: ADR-0011/no-content-after-purging
    provenance: authored
  - domain: active-session-privacy
    rule: "Ingest rechecks tenant membership before any domain write."
    scope: ingest routes
    handle: ADR-0011/ingest-membership-recheck
    provenance: authored
  - domain: active-session-privacy
    rule: "The companion holds the credential only in the keychain or memory."
    scope: apps/capture-companion
    handle: ADR-0011/credential-held-securely
    provenance: authored
  - domain: active-session-privacy
    rule: "Final transcript text lives only in session observation rows."
    scope: session content storage
    handle: ADR-0011/transcripts-in-observations
    provenance: authored
  - domain: active-session-privacy
    rule: "Selected screenshots live only as owner-private image artifacts with payloads, checked by leading bytes and served inert."
    scope: session content storage and download routes
    handle: ADR-0011/screenshots-as-private-artifacts
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
    rule: "Retention is delete at end, thirty days from end, or until deleted, defaulting to delete at end."
    scope: session start and retention control
    handle: ADR-0011/retention-modes
    provenance: authored
  - domain: active-session-privacy
    rule: "Only the session owner chooses or shortens retention."
    scope: session start and retention control
    handle: ADR-0011/owner-chooses-retention
    provenance: authored
  - domain: active-session-privacy
    rule: "One idempotent purge deletes all session content, including its jobs, job payloads and relay rows, and leaves a content-free tombstone."
    scope: products/interview session purge and the worker session loop
    handle: ADR-0011/complete-session-purge
    provenance: authored
  - domain: active-session-privacy
    rule: "Traces and logs hold ids, revisions, profiles, durations, outcomes, byte counts and validation paths, never content, credentials or content hashes."
    scope: session core, processor and routes
    handle: ADR-0011/id-only-traces
    provenance: authored
  - domain: active-session-privacy
    rule: "Captured text, images and pre-loaded role text are untrusted data that cannot grant tools, change policy, request secrets or override allowed actions."
    scope: session processor and interview policy
    handle: ADR-0011/captured-input-untrusted
    provenance: authored
  - domain: active-session-privacy
    rule: "Session-authored drafts render without fetching external resources."
    scope: Studio session view and Workspace draft rendering
    handle: ADR-0011/inert-draft-rendering
    provenance: authored
  - domain: active-session-locality
    rule: "Every AI profile declares its locality in the shared profile configuration source, and a missing or unknown value is treated as remote."
    scope: packages/ai-runtime profiles and shared host configuration
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
    rule: "Every model call carrying session content goes through the gateway with the session policy."
    scope: the session processor and interview policy
    handle: ADR-0011/model-calls-gateway-routed
    provenance: authored
  - domain: active-session-locality
    rule: "A stage with no device implementation is refused in device-only mode."
    scope: the session processor and interview policy
    handle: ADR-0011/unlisted-stage-refused
    provenance: authored
  - domain: active-session-locality
    rule: "A session may tighten its processing policy to device-only but never loosen it."
    scope: session control
    handle: ADR-0011/tighten-only-locality
    provenance: authored
  - domain: active-session-rehearsal
    rule: "A session never writes a Rehearsal scorecard."
    scope: session start and the Rehearsal flow
    handle: ADR-0011/no-second-scorecard
    provenance: authored
  - domain: active-session-rehearsal
    rule: "Live assistance is disabled in a strict rehearsal."
    scope: session start
    handle: ADR-0011/strict-rehearsal-no-assistance
    provenance: authored
  - domain: active-session-rehearsal
    rule: "The tombstone keeps owner, rehearsal run id, strict flag and a content-free count of shown drafts."
    scope: active_sessions tombstone and the Rehearsal save
    handle: ADR-0011/tombstone-keeps-hint-count
    provenance: authored
  - domain: active-session-rehearsal
    rule: "In a non-strict rehearsal each shown assistance draft counts as a hint at the existing hint cost, keyed by the rehearsal run id."
    scope: session actions and the Rehearsal scorecard
    handle: ADR-0011/assistance-counts-as-hints
    provenance: authored
---

# ADR-0011 — Keep Active Session data private to the actor and enforce locality before dispatch

## Context

ADR-0010 fixes where the Active Session processor runs and how it talks to the companion, and defers private data, retention, locality and untrusted input to this decision. A transcript of the candidate and the interviewer, and screenshots of their screen, are the most private data Interview Studio holds; OBJ-5 requires them to stay inside the owner's view, and OBJ-3 requires a rehearsal to keep one scorecard.

Terms. The owner is the user who started the session. The processing policy is `device-only` or `permitted-remote`. Product means the product id `omnitech.interview`. The fence, lease, sources and the terminal gateway are as in ADR-0010 and the agent-job event route. A request's actor is its authenticated user, and row security binds tenant and actor to a row's tenant and owner. The claim is the worker's cross-tenant lookup of sessions to process (ADR-0010). Retention is the policy chosen at start; a purge is the deletion act, triggered by session end, owner delete or retention expiry. The tombstone is the purged session row, content-free, holding the purge outcome, counts and time, plus the rehearsal fields below. Purging is the session status set when a purge starts, after which ingest and dispatch are refused; ADR-0010's lifecycle (created, active, paused, ended) gains it. This amends ADR-0010/stop-authority: credential expiry and a companion stop pause capture rather than end the session, and the owner, owner delete or the duration cap end it.

Code facts, verified in this branch:

- Candidacy, interview and `ai.agent_jobs` rows, and the job event and artifact tables, are scoped by tenant only. Foreign keys are enforced without row security, so a session could reference another member's resource that it cannot read.
- Documents (ADR-0009) is the precedent: owner-scoped forced policies, composite tenant and owner keys, trigger-based link checks, and restrictive `platform.artifacts` policies that list only three document types, so any other type is discoverable by the whole tenant.
- Artifact payloads are owner-only bytea up to 10 MiB. The assistant draft table uses text keys, so a UUID session table cannot reference it by foreign key.
- `AiProfile` has no locality; "local" is display metadata, and a URL-pattern guess in the host is unreliable. The on-device model reaches the server through a Postgres-backed relay to an open browser tab, outside `AiExecutionGateway`; it is text-only with an 8k window. The relay stores each call's input until the same scope next opens a call.
- `ai.agent_jobs.session_id` is the agent runtime's resume id and gates job resume; it is not an Active Session link. The worker's per-event cancellation check and the terminal gateway's event route read jobs with a tenant and no actor. Job payloads have an expiry that no process deletes, and no retention or purge job exists.
- Rehearsal writes one scorecard at the end, from the client, with a strict input schema and a priced hint.

Binding limits: ADR-0002 to ADR-0010, one new package and one new app, no new service or storage engine, `omnitech-assistant` unchanged. ADR-0004 to ADR-0007 are still Proposed and this decision depends on them; it extends the narrow-access list of ADR-0005 section 6.

## Decision

**Ownership and row security.** `active_sessions`, `session_observations` and `session_actions` are product-owned tables with tenant and owner ids, under forced row security binding both, as in Documents. Children reference tenant, owner and session so a child cannot name another owner's session. The session row holds status, lease, fence, retention, processing policy, the credential hash and expiry, and a start-time snapshot of the permitted sources. The database refuses loosening the processing policy, lengthening retention, and changing tenant, owner, links or the sources snapshot; only the purge, while the session is purging, may set links, the snapshot and the credential to null, never to another value, and it clears links before deleting the rows they name. Links are columns of the session and action rows, set only by insert and never from null to a value after start. Deleting an interview, candidacy or profile revision is refused while a session that is not a tombstone links it, so an until-deleted session blocks it until the session is deleted.

**Linked resources.** A session may link an interview, candidacy, candidate-profile revision, Workspace draft, agent job or artifact only after the database confirms tenant, owner, product and, for artifacts, type. A composite foreign key is used where the target has a tenant key; drafts, being text-keyed, are checked in the same transaction and again by the publish port. A candidacy qualifies through the actor's own person record (ADR-0009), and an interview only through that candidacy. The security suite tests a foreign and a nonexistent id for each link kind. The link check never uses `ai.agent_jobs.session_id`.

**Read paths.** Streams, downloads, context assembly, job results and artifact discovery each open an actor-scoped transaction for the owner and read only owner-scoped data, and dereferencing a linked resource runs in that transaction too, so a link never widens access.

**Agent jobs.** A job created by a session carries an immutable private marker set only by the session dispatch path. A restrictive policy admits a private job's rows to its creator or to the agent worker; child event and artifact rows are admitted through their parent job. Non-session jobs are unchanged, and a caller with no actor sees no private rows. Payload rows stay reference-bound, as in ADR-0005 section 6: the reference is unguessable and disclosed only through a guarded job. The worker repository's reads run under the existing worker setting in its one owning file, and the terminal gateway's service-token event route sees no private rows; whether it learns the owner is a dev-module decision and a gate for session agent jobs in permitted-remote sessions. The action row and its job id are committed before the job exists, and job creation runs under a lock on the session row that verifies status active and a current fence, which the purging transition also takes, so no private job is unnamed or created after the purge reads the actions. The job service accepts that caller-supplied id. Cancellation, resume and every other job path used by a session carry the actor; cancellation distinguishes a job it cannot see from a terminal one and fails closed, and resume verifies the session is active under the same lock, finding the session through the action row that names the job.

**Artifacts.** Screenshots are artifacts of a session type, named in the restrictive owner-only select, insert, update and delete policies in the migration that introduces them. Artifact rows are never updated, and deletion needs a named purge setting with one owning file and matching owner and type. A same-tenant non-owner listing returns no session artifact, and a test proves it.

**Claim and credential lookup.** The worker claims sessions across tenants through one named setting, `app.session_worker`, with one owning file listed in the tenant-context-boundary test. Under it the database permits changing only lease and fence columns; the claim port projects tenant, owner and session ids, which refines ADR-0010's projection because the owner id makes the actor-scoped transaction possible. It runs as the application role, never an owner or BYPASSRLS role, and purge sweeps use it. The port projection omits the credential hash. After the claim the worker acts as the owner only in the processor and purge paths. Ingest is a credential-authenticated route class that clarifies ADR-0004 decision 4: it carries the tenant slug and resolves its session by credential hash through a select-only named policy that admits that one row; a credential bound to another tenant is refused. The credential is the authenticated principal for this route class, membership is rechecked before any domain write (ADR-0004), and installation and permission checks precede any domain work, which starts after the credential lookup, itself not domain work.

**Credential.** The ingest-only credential (ADR-0010, not a login token, ADR-0006) is stored hashed with one live credential per session. It is at least 128 random bits, so a fast hash suffices, and a failed lookup gives one refusal whether it is unknown, expired or revoked. Its expiry is shorter than and bounded by the session duration cap, so an expiry pauses a live session, and replacement is the only extension and never passes the cap. The channel that delivers a replacement to the companion is a dev-loop decision and never a URL or log. Renewal is owner-initiated from Studio: it mints a replacement and revokes the old one, and the companion never renews itself. Revocation happens on end, purge, membership removal or owner request, and ingest rechecks membership every time. The companion holds it only in the keychain or memory. There is no device binding; a stolen credential can only append observations to one session, an accepted risk. The expiry value, dependency pinning and rotation UX are dev-loop decisions.

**Content storage.** Final transcript text lives only in observation rows; interim text is never stored. A selected screenshot is stored once as a compressed PNG, JPEG or WebP artifact, accepted by its leading bytes, never SVG and never decoded by the server, and served with its stored type, no sniffing and a restrictive content policy. A digest unique per tenant, owner and session dedupes stored bytes only; observations stay keyed by source and event id (ADR-0010). No other row holds frame bytes or transcript text. Derived context and summaries are session content.

**Raw audio.** Raw audio exists only in the companion's bounded memory and is dropped on pause, stop and credential expiry. The wire contract has no audio kind; retaining audio needs an amendment.

**Bounds.** `active-session-contracts` carries hard maxima for text, screenshot and envelope size, per-session counts, ingest rate and session duration, with one active session per owner. Over a limit ingest refuses with a code and writes nothing. The dev module sets the values; they are frozen as contract constants, and raising one needs an amendment.

**Retention and purge.** The owner chooses delete at end, thirty days from end or until deleted at start, and may only shorten it later; the default is delete at end. Only owner end, owner delete or the duration cap end a session; credential expiry and a companion stop pause capture visibly and keep it open (the processor derives pause from credential expiry and heartbeat age before any dispatch), and pause does not end it. The database refuses new observations, screenshot artifacts and published results once a session is ended or purging, while a paused session may still record outcome and suppression rows, so nothing lands after the purging mark. One purge module runs in the worker session loop on end, on owner delete and in a periodic sweep past retention. The purge makes the session purging (refusing ingest and dispatch, cancelling jobs, revoking the credential) and, once its named jobs are terminal or a bounded wait has passed (after which it deletes the job rows and a worker write to a missing job fails closed), collects their payload references in the transaction that locks and deletes the job rows (a payload with no job row counts as content for the final check), observations before the artifacts they link, actions, derived context, session-created Workspace drafts, screenshot artifacts with their payloads, the session's jobs with their events and artifacts, every payload those jobs referenced, and the relay rows its actions name. A job resume must supersede the payload it replaces. A draft the owner promoted or exported to a Document is outside the purge, because session-created drafts carry a provenance mark that promotion clears, and the UI says so. A crash resumes at the next sweep, and a session becomes a tombstone only when a final check finds zero content rows. A check enumerates every table that references a session and every job-reachable table and fails on one the purge does not cover. Deleted rows persist in backups until rotation.

**Traces and untrusted input.** Traces and logs hold ids, revisions, fence, profile and locality decision, durations, outcomes, byte counts and validation paths, never content, credentials or content hashes; a canary check across ingest, dispatch, failure and purge proves it. Captured text, screen text, images and pre-loaded role text are observation data only. They sit in labelled blocks outside policy text, and model output is parsed against a closed schema that rejects tool, locality, privacy, retention and credential fields and records a suppression by ids. With ADR-0010's tool-free fast path, captured content cannot select a profile, tool, retention mode or recipient. Session-authored drafts render without fetching external resources (the inert preview of ADR-0009), keeping the guide shape of ADR-0008. Fixtures are synthetic and a test scans them for real names, employers and compensation figures.

**Locality.** Each AI profile declares device, private-network or remote locality in the shared profile configuration source, never inferred from a URL; missing or unknown is remote. Device-only admits only the device class; permitted-remote admits all three; private-network is an operator-controlled host and is not device unless declared so. A declared-device profile with a URL must resolve to loopback, and a mis-declared profile is accepted operator trust. A session records its processing policy at start; the processor derives each request's policy from the session row, never from ingest or model content. `AiExecutionGateway` rejects a non-device profile for a device-only request at resolution and again inside each method just before dispatch, covering target listing and resume; an unmet policy is a non-retryable `policy-refused` outcome naming ids only, and there is no fallback. Cancellation stays allowed. A session may tighten to device-only and never loosen.

**Locality by stage.** Every model call carrying session content, including retrieval ranking, summarisation and classification, goes through the gateway with the session policy; database retrieval without a model is allowed, and any stage with no device implementation is refused, not degraded. Transcription runs only in the companion with OS on-device recognition and a visible capability check. Image interpretation, coding inference and agent jobs are refused; code-runner execution is refused unless the host declares the runner device-local. Answer generation uses a device profile, and a prompt over its window is refused. The on-device model reaches the worker as a relay-backed device profile composed in the worker-side gateway, scoped to the owner's tenant and actor; a missing device is a retryable `unavailable` outcome, never a fallback. If that cannot be composed within ADR-0002 and ADR-0003, or purge cannot remove relay rows without changing `omnitech-assistant`, the stage is refused in device-only mode and the dev module stops at the ADR-0002 checkpoint. Storing content in the owner's tenant database is not model egress and stays allowed. Studio shows the policy and the profile used per stage.

**Rehearsal.** A rehearsal session records, immutably at start, an opaque rehearsal run id minted by the client and the strict flag, trusted only for the same owner's session, and never writes `rehearsal_sessions`; the Rehearsal flow stays the only scorecard writer. Live assistance is disabled in a strict rehearsal. In a non-strict one each shown draft is an action that counts as a hint at the existing cost, and the scorecard save carries the run id so the server derives the hint count from the owner's sessions with that run id, refusing a strictness mismatch and counting none when no session matches. The count is finalised before the actions are deleted, lives on the tombstone, which accepts no other writes besides purge state, survives purge, and is added to the score input rather than stored as reveals. The client already reports checks, reveals and strict, so minting the id there adds no new trust; this adds an optional field to the interview-contracts input, so a save without it behaves as today and counts none, and one run id yields one hint derivation. The hint cap and de-duplication are dev-module work.

## Alternatives Considered

### Option A — Store transcripts as artifacts
- **Pros:** reuses the artifact path.
- **Cons:** a row per segment; artifact listing becomes the discovery surface.
- **Why not:** transcripts need ordering and dedup, so only large blobs use artifacts.

### Option B — Generic `platform` session tables or reuse `assistant` tables
- **Pros:** shared across products.
- **Cons:** puts Interview semantics in the platform or in the unchanged assistant.
- **Why not:** ADR-0004 and the book Constraint.

### Option C — Service-level job owner check, or a guard on every job
- **Pros:** no policy change, or uniform protection.
- **Cons:** a service check is not enforced by the database; a table-wide guard breaks the worker and terminal gateway reads.
- **Why not:** a per-row private marker gives database enforcement with the least blast radius.

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
- Device-only refuses any model dispatch to a non-device profile, and session requests never bypass the gateway; the assistant's own chat path is unchanged.
- Rehearsal keeps one scorecard (OBJ-3), and the pattern serves another product's sessions (OBJ-6).

**Negative:**
- Not chosen: sliding or device-bound credentials (owner-initiated replacement is simpler and the stolen-credential risk is append-only) and a Next-host relay for the device model (the processor is in the worker, ADR-0010).
- The private job marker touches the agent-job repository, worker and terminal-gateway routes; a missed caller sees no private rows. This platform change warrants the ADR-0002 scope checkpoint.
- Device-only answers are limited to a text-only 8k model, and may be unavailable if the relay cannot be composed in the worker.
- Screenshot bytea in the primary cluster adds bloat after purge; the caps bound it.
- Two new settings (claim, purge delete) and one named lookup policy (credential) each need a column-level or type-level test.
- The purge does not cover backups, and declared device locality rests on operator trust.

**Follow-on work:**
- Dev-module decisions: table and column shapes, trigger and policy names, migration numbering (after the PB-0001 head), the removed-member sessions rule (purge or freeze, and the actor scope the purge uses), the bounded-wait value, numeric limits, credential expiry value, dependency pinning, hint cap and de-duplication, code-runner device-local declaration, local OCR, account-deletion cascade, and a general sweep of expired job payloads.
- Same-tenant cross-user, locality-egress and injection evidence are produced by the dev loops.

## References

- [[objectives]]
- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0008-interview-answers-are-structured-guides-that-rende]]
- [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]]
- [[adrs/ADR-0010-host-the-active-session-processor-in-the-agent-worker]]
- [[research/concepts/interview-domain-model]]
- [[research/references/ai-execution-boundaries]]
