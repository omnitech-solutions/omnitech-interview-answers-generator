---
id: ADR-0010
title: Host the Active Session processor in the agent worker behind a versioned wire contract
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
tags: [active-session, worker, contracts, privacy, interview]
related_briefs: []
related_research: [concepts/interview-domain-model, references/ai-execution-boundaries]
governs:
  - domain: active-session
    rule: "An Interview, an Active Session and an Agent Job are separate records."
    scope: products/interview active-session persistence and services
    handle: ADR-0010/three-concept-split
    provenance: authored
  - domain: active-session
    rule: "The companion and Studio exchange only versioned active-session-contracts schemas."
    scope: packages/active-session-contracts and apps/capture-companion
    handle: ADR-0010/versioned-wire-contract
    provenance: authored
  - domain: active-session
    rule: "Ingest identity comes only from the session credential, and stream and control identity only from the user's session, never from request or observation content."
    scope: active-session ingest, stream and control routes
    handle: ADR-0010/identity-from-credential
    provenance: authored
  - domain: active-session
    rule: "The session credential grants ingest for one session only and has a short hard maximum lifetime."
    scope: active-session credential minting and ingest
    handle: ADR-0010/credential-ingest-scope
    provenance: authored
  - domain: active-session
    rule: "The session credential is stored hashed and is never logged or placed in a URL."
    scope: active-session credential storage and logging
    handle: ADR-0010/credential-storage
    provenance: authored
  - domain: active-session
    rule: "The session processor runs in apps/agent-worker as its own loop beside the agent-job loop."
    scope: apps/agent-worker
    handle: ADR-0010/worker-hosted-processor
    provenance: authored
  - domain: active-session
    rule: "The session core imports only active-session-contracts."
    scope: the session core directory in products/interview, named in the boundary test
    handle: ADR-0010/neutral-core-imports
    provenance: authored
  - domain: active-session
    rule: "A failure in one worker loop never stops the other."
    scope: apps/agent-worker
    handle: ADR-0010/loop-isolation
    provenance: authored
  - domain: active-session
    rule: "The worker reads and writes session data only inside a tenant-scoped transaction after a minimal cross-tenant claim."
    scope: session processor persistence access
    handle: ADR-0010/tenant-scoped-worker-access
    provenance: authored
  - domain: active-session
    rule: "Observations are deduplicated by source and event id."
    scope: session core and session persistence
    handle: ADR-0010/idempotent-observation
    provenance: authored
  - domain: active-session
    rule: "Dispatch is deduplicated by session, logical task, task revision and action kind."
    scope: session core and session persistence
    handle: ADR-0010/idempotent-dispatch
    provenance: authored
  - domain: active-session
    rule: "The fast-path model call has no tools."
    scope: session processor fast path
    handle: ADR-0010/fast-path-no-tools
    provenance: authored
  - domain: active-session
    rule: "Job, retrieval and publish decisions come only from validated structured fields."
    scope: session processor and interview policy
    handle: ADR-0010/structured-field-decisions
    provenance: authored
  - domain: active-session
    rule: "A result publishes only while its session lease fence, session status and task revision are all current."
    scope: session actions and Workspace draft publication
    handle: ADR-0010/fenced-current-publish
    provenance: authored
  - domain: active-session
    rule: "Pause or end refuses new dispatch and cancels the session's in-flight jobs."
    scope: session processor
    handle: ADR-0010/pause-end-suppression
    provenance: authored
  - domain: active-session
    rule: "Only the authenticated user's session control starts or resumes capture; only that control, credential expiry or the companion's local stop ends it."
    scope: session control and capture companion
    handle: ADR-0010/stop-authority
    provenance: authored
  - domain: active-session
    rule: "Session output and transcript content are never written into the experience matrix or exercise catalogue."
    scope: session actions, Workspace publication and interview policy
    handle: ADR-0010/no-promotion
    provenance: authored
  - domain: active-session
    rule: "Active Session assistance makes no undetectability claim and adds no detection evasion."
    scope: the whole Active Session capability
    handle: ADR-0010/no-undetectability-or-evasion
    provenance: authored
  - domain: active-session
    rule: "Active Session assistance never submits, messages or operates an external interview interface."
    scope: the whole Active Session capability
    handle: ADR-0010/no-external-interface-operation
    provenance: authored
---

# ADR-0010 — Host the Active Session processor in the agent worker behind a versioned wire contract

## Context

Interview Studio prepares answers before an interview. The Active Session capability must also assist during an agreed rehearsal or interview: observe, understand the current task, retrieve approved context, produce a source-backed draft, and publish it, without prompting per question. The operator's real recruiter-screen profile (run notes of PB-0002 RUN-001, sections 1 to 8) shows what the loop must survive: split and corrected transcript segments, backchannels, long task-less monologue, compound and follow-up questions, and a question every one to three minutes with a 30 to 90 second answer window.

Three existing facts shape the decision. The agent worker is one poll loop that claims an agent job under a lease, but the lease is never renewed and job writes carry no fencing token, so a stalled worker can still write over its successor. The `AiExecutionGateway` and its model configuration are built only in the web host, while Codex and Claude Code run only in the worker (ADR-0007). The existing assistant run queue lives in the Next process and stays unchanged. The package-boundary test knows no neutral session package and cannot yet scope imports to a directory.

ADR-0004 to ADR-0007 are still Proposed and this decision depends on them; ADR-0002 to ADR-0009 and current Interview behaviour are preserved. Binding limits come from the book Constraint: exactly one new package and one new app, no broker, workflow engine, vector database or second worker service, `omnitech-assistant` unchanged, and interview-specific behaviour in `products/interview` (ADR-0002, ADR-0003, ADR-0004). Row security, retention, locality and untrusted-input rules are ADR #2's decision; this ADR references them and does not decide them.

## Decision

**Three concepts.** An Interview is the agreed engagement and is unchanged. An Active Session is a bounded run with a lifecycle (created, active, paused, ended) that owns observations, task state and actions, and references at most one Interview, drafts and artifacts. An Agent Job stays the existing leased AI execution; a session action may reference a job by id, and a job never carries session identity. Ending a session does not alter its Interview, and cancelling a job does not end the session.

**Terms.** A logical task is one question or instruction and its follow-ups; a task revision increments when it changes, and an earlier answer is stale once a newer revision exists. ADR #2 is the PB-0002 decision on private data, actor-level privacy and locality policy, not yet numbered.

**Wire contract.** One new package, `active-session-contracts`, is the only source of truth for companion-to-Studio traffic: versioned observation envelopes (`transcript.final`, `screen.snapshot`, `source.disconnected`, `capture.gap`), acknowledgements, control messages and credential claims. Unknown versions and kinds are rejected, and identity fields inside observation content are rejected, not ignored. The macOS capture companion is the one new app; it consumes only this contract, holds no database or provider credentials, and cannot be told to broaden its sources, because the source set is fixed by the session record and credential at start.

**Identity.** Credential minting is part of the user's start action: the product backend mints a credential bound to tenant, actor and one session, valid for ingest on that session only, with a hard maximum lifetime, stored hashed, revocable, and never logged or carried in a URL. Stream and control routes accept the user's session, not this credential. Control state (pause, end) reaches the companion only as a field of ingest acknowledgements and refusals; the companion holds no control credential, refuses any command from another channel, and may send a content-free heartbeat so that resume is observable. A session that outlives its credential ends capture visibly until renewal exists. It is not a login token (ADR-0006). Expiry, pause, end or revocation refuse ingest; companion contact is limited to Studio.

**Placement.** A neutral session core holds ordering, dedup, task identity and revisions, dispatch decisions and publish eligibility. It lives in `products/interview` under its own directory, imports only `active-session-contracts`, and is guarded by a directory-scoped import check added to the package-boundary test. Interview policy, grounding, persistence and publishing are supplied by the product through ports; the core holds mechanics only. The processor is exported through the product's public worker entrypoint and registered in `apps/agent-worker` as a second loop. Each loop has its own error handling and backoff, shared resources close only after both loops settle, and a failure in one never stops the other; the current `main.ts` does not satisfy this and the implementation must. The worker claims sessions across tenants through a minimal projection only, every later read or write runs in a tenant-scoped transaction, and it never uses an owner or BYPASSRLS role; the claim port is injected, because the worker storage entrypoint is importable only from `apps/agent-worker`. Ingest, stream and control routes mount in the product backend behind tenant membership resolution (ADR-0004).

**Fast path and jobs.** Interpret-and-answer is one structured `AiExecutionGateway` call by profile or capability, with retrieval over the approved matrix revision pinned at session start. An Agent Job is created through the job service only for repository navigation or iterative repair. A prose draft never waits on a job, and coding latency never blocks it. The fast-path call carries no tools; job creation, retrieval and publication follow validated structured fields, never model free text, and injection handling is ADR #2's. The processor receives an `AiExecutionGateway` from its host, built from the same profile and model configuration source as the web host, exported from an existing package or the worker app and not duplicated. If that cannot be done within ADR-0003 and the one-new-package limit, the dev module stops at the ADR-0002 scope checkpoint; it adds no package and does not move the processor into Next.

**Correctness.** Observations deduplicate by source and event id; a resend returns the original acknowledgement. Dispatch deduplicates by session, logical task, task revision and action kind; a failed dispatch records its outcome, and a retry is deduplicated only against a succeeded or in-flight dispatch. A changed constraint or "part two" follow-up increments the task revision and marks the earlier answer stale rather than editing it; backchannels, fillers and task-less monologue never open or revise a task; a corrected segment supersedes the earlier one; a deferred topic stays in task state. The Interview policy decides whether an utterance revises a task; the core enforces the mechanics.

**Fencing.** The fence is a per-session counter and the lease is its time-bounded holder: acquiring a lease increments the fence, the holder renews while healthy, and a holder that finds a newer fence stops. A stale holder cannot write. The cross-tenant claim writes only lease and fence columns and returns tenant and session ids only. The core decides eligibility and the persistence port enforces it atomically with the write; a failed check records a suppression with ids only. The fence is session-specific and existing agent-job writes are unchanged, so job output is untrusted until a fenced publish succeeds.

**Control and scope.** Pause or end flips status first, requests cancellation of the session's in-flight jobs (an already-terminal job counts as cancelled), and refuses dispatch; in-flight work may finish but cannot publish. Session output and transcript content are never written into the experience matrix or exercise catalogue; the session writes only to its own records and a session-owned Workspace draft. Locality is re-checked before dispatch with no silent fallback (rules in ADR #2). Only the authenticated user's session control starts, pauses or stops capture, and the companion stops locally while Studio is unavailable and sends no content while stopped. Coding output publishes to a session-owned Workspace draft that keeps the structured-guide shape of ADR-0008, through an expected-revision check, and reports generated, tests passed and fully verified as distinct states. Traces record ids, revisions, profiles, durations and outcomes, never conversation content, and validation errors name paths and ids only (ADR-0007). The capability is for rehearsals and interviews where recording and assistance are agreed, uses ordinary OS permissions, and claims nothing about undetectability.

**Unverifiable here.** ScreenCaptureKit permissions, on-device speech and a real call workload are recorded as unverified, and a protocol-conformant fixture companion carries the conformance tests. The vendored on-device model is browser-hosted and text-only by source inspection; it is not assumed to provide speech, vision or coding.

## Alternatives Considered

### Option A — Treat each observation or session as an Agent Job
- **Pros:** reuses the claim loop and job records.
- **Cons:** a job row per transcript fragment; the job lifecycle has no pause, end, revision or fencing; interview policy leaks into a neutral package.
- **Why not:** it merges the Session and Agent Job concepts the goal requires apart.

### Option B — Separate session service, queue or workflow engine
- **Pros:** independent scaling and isolation.
- **Cons:** no demonstrated need; a second failure domain.
- **Why not:** forbidden by the book Constraint and by ADR-0002.

### Option C — Run the processor in the Next process, like the assistant run queue
- **Pros:** the gateway is already built there.
- **Cons:** the host would own a continuous loop whose restart safety rests only on the fence.
- **Why not:** a continuous loop in Next has no worker lease or stop boundary, and ADR-0007 keeps agent work in the worker.

### Option D — Put session columns on the Interview
- **Pros:** fewer records.
- **Cons:** destroys the three-concept split.
- **Why not:** a session is bounded and short-lived, an Interview is durable.

### Option E — Let the companion import `interview-contracts`
- **Pros:** no new package.
- **Cons:** couples the companion to private Interview schemas and blocks reuse of the wire protocol by another product.
- **Why not:** the wire protocol has two independent consumers and its own versioning, which is what ADR-0003 requires for a new package.

## Consequences

**Positive:**
- A resent observation, a restarted worker, a late result, a pause and an end each have a defined, testable outcome (OBJ-5).
- The wire contract can serve another product (OBJ-6); the core stays in the product until a second consumer justifies lifting it (ADR-0003). Coding agents can drive the same routes (OBJ-4).
- No new infrastructure beyond one package and one app.

**Negative:**
- The fence needs a session lease and a named worker policy; the migration contract belongs to ADR #2.
- The worker depends on gateway availability under the Decision's gateway requirement; failing it triggers the ADR-0002 scope checkpoint. The new app and second loop already warrant that checkpoint.
- The worker now handles conversation content, which widens the isolation ADR-0007 gave it; ADR-0007 is unchanged, and tenant-scoped access and id-only traces are the compensating requirements.
- The core's purity rests on a new directory-scoped boundary check; the companion's boundary needs a manifest and source scan because Swift is outside pnpm.
- Sharing the worker process shares a failure domain; restart safety rests on the fence.

**Follow-on work:**
- ADR #2: private data, actor-level row security, retention, locality and untrusted-input rules, and the exact migration.
- Decide wake mechanism (poll or database notification), and the fast-path latency budget measured at real timing and 4x.
- Decide whether fencing is later retrofitted onto agent-job writes.
- Deferred to ADR #2 or the dev loops (grounding classification and unsupported-reference rejection are Interview policy behind the core's ports; the Studio session control is a dev-loop deliverable consuming the control and stream routes; the credential's exact lifetime is set by ADR #2 and is at most one session), with acceptance of this ADR not ratifying persistence shape: per-dereference actor checks, ingest size, rate and quota limits, dependency pinning, credential renewal and device binding, and the same-tenant cross-user, locality and untrusted-input Evidence. Replay fixtures (E-A1 to E-A3), grounding, and latency at real timing and 4x belong to the dev loops.
- Migration numbering depends on the Interview Documents base (PB-0001).

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0008-interview-answers-are-structured-guides-that-rende]]
- [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]]
- [[research/concepts/interview-domain-model]]
- [[research/references/ai-execution-boundaries]]
