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
    rule: "An Interview, an Active Session and an Agent Job are separate records that reference one another and never stand in for one another."
    scope: products/interview active-session persistence and services
    handle: ADR-0010/three-concept-split
    provenance: authored
  - domain: active-session
    rule: "The capture companion and Studio exchange only observations and commands that validate against versioned active-session-contracts schemas."
    scope: packages/active-session-contracts and apps/capture-companion
    handle: ADR-0010/versioned-wire-contract
    provenance: authored
  - domain: active-session
    rule: "Tenant, actor and session identity come only from a short-lived session credential, never from observation content."
    scope: active-session ingest, stream and control routes
    handle: ADR-0010/identity-from-credential
    provenance: authored
  - domain: active-session
    rule: "The session processor runs in apps/agent-worker as a separately bounded loop beside the agent-job loop, and the neutral session core imports only active-session-contracts."
    scope: apps/agent-worker and the session core
    handle: ADR-0010/worker-hosted-processor
    provenance: authored
  - domain: active-session
    rule: "Observations are deduplicated by source and event id, and dispatch by session, logical task, task revision and action kind."
    scope: session core and session persistence
    handle: ADR-0010/idempotent-observation-and-dispatch
    provenance: authored
  - domain: active-session
    rule: "A result publishes only while its session lease fence, session status and task revision are all current."
    scope: session actions and Workspace draft publication
    handle: ADR-0010/fenced-current-publish
    provenance: authored
  - domain: active-session
    rule: "Pause or end suppresses new dispatch and rejects late publication, and only the authenticated user's session control starts, pauses or stops capture."
    scope: session processor and session control
    handle: ADR-0010/pause-end-stop-authority
    provenance: authored
  - domain: active-session
    rule: "Active Session assistance makes no undetectability claim, adds no detection evasion, and never submits, messages or operates an external interview interface."
    scope: the whole Active Session capability
    handle: ADR-0010/agreed-visible-assistance
    provenance: authored
---

# ADR-0010 — Host the Active Session processor in the agent worker behind a versioned wire contract

## Context

Interview Studio prepares answers before an interview. The Active Session capability must also assist during an agreed rehearsal or interview: observe, understand the current task, retrieve approved context, produce a source-backed draft, and publish it, without prompting per question. The operator's real recruiter-screen profile (run notes of PB-0002 RUN-001, sections 1 to 8) shows what the loop must survive: split and corrected transcript segments, backchannels, long task-less monologue, compound and follow-up questions, and a question every one to three minutes with a 30 to 90 second answer window.

Three existing facts shape the decision. The agent worker is one poll loop that claims an agent job under a lease, but the lease is never renewed and job writes carry no fencing token, so a stalled worker can still write over its successor. The `AiExecutionGateway` and its model configuration are built only in the web host, while Codex and Claude Code run only in the worker (ADR-0007). The existing assistant run queue lives in the Next process and stays unchanged. The package-boundary test knows no neutral session package and cannot yet scope imports to a directory.

Binding limits come from the book Constraint: exactly one new package and one new app, no broker, workflow engine, vector database or second worker service, `omnitech-assistant` unchanged, and interview-specific behaviour in `products/interview` (ADR-0002, ADR-0003, ADR-0004). Row security, retention, locality and untrusted-input rules are ADR #2's decision; this ADR references them and does not decide them.

## Decision

**Three concepts.** An Interview is the agreed engagement and is unchanged. An Active Session is a bounded run with a lifecycle (created, active, paused, ended) that owns observations, task state and actions, and references at most one Interview, drafts and artifacts. An Agent Job stays the existing leased AI execution; a session action may reference a job by id, and a job never carries session identity. Ending a session does not alter its Interview, and cancelling a job does not end the session.

**Wire contract.** One new package, `active-session-contracts`, is the only source of truth for companion-to-Studio traffic: versioned observation envelopes (`transcript.final`, `screen.snapshot`, `source.disconnected`, `capture.gap`), acknowledgements, control messages and credential claims. Unknown versions and kinds are rejected, and identity fields inside observation content are rejected, not ignored. The macOS capture companion is the one new app; it consumes only this contract, holds no database or provider credentials, and cannot be told to broaden its sources, because the source set is fixed by the session record and credential at start.

**Identity.** Studio mints a short-lived credential bound to tenant, actor and one session, with ingest scope for that session only. It is not a login token (ADR-0006). Expiry, pause, end or revocation refuse ingest.

**Placement.** A neutral session core holds ordering, dedup, task identity and revisions, dispatch decisions and publish eligibility. It lives in `products/interview` under its own directory, imports only `active-session-contracts`, and is guarded by a directory-scoped import check added to the package-boundary test. Interview policy, grounding, persistence and publishing plug in as ports. The processor is exported through the product's public worker entrypoint and registered in `apps/agent-worker` as a second, independently abortable loop with its own interval, lease and fence; failure of one loop never stops the other. Ingest, stream and control routes mount in the product backend behind tenant membership resolution (ADR-0004).

**Fast path and jobs.** Interpret-and-answer is one structured `AiExecutionGateway` call by profile or capability, with retrieval over the approved matrix revision pinned at session start. An Agent Job is created through the job service only for repository navigation or iterative repair. A prose draft never waits on a job, and coding latency never blocks it. The worker must reach the same gateway profile resolution as the web host without duplicating model configuration, and the dev module decides how within ADR-0003 and the one-new-package limit.

**Correctness.** Observations deduplicate by source and event id; a resend returns the original acknowledgement. Dispatch deduplicates by session, logical task, task revision and action kind. A changed constraint or "part two" follow-up increments the task revision and marks the earlier answer stale rather than editing it; backchannels, fillers and task-less monologue never open or revise a task; a corrected segment supersedes the earlier one; a deferred topic stays in task state. The Interview policy decides whether an utterance revises a task; the core enforces the mechanics.

**Fencing.** The session processor takes a per-session lease with a monotonic fence incremented on every acquisition and renewed while working. Every state write and publication checks the fence, session status and task revision, and a failed check records a suppression with ids only. The fence is session-specific: existing agent-job writes are not altered by this decision.

**Control and scope.** Pause or end flips status first; in-flight work may finish but cannot publish, and dispatch is refused. Only the authenticated user's session control starts, pauses or stops capture, and the companion stops locally while Studio is unavailable and sends no content while stopped. Coding output publishes to a session-owned Workspace draft through an expected-revision check and reports generated, tests passed and fully verified as distinct states. Traces record ids, revisions, profiles, durations and outcomes, never conversation content (ADR-0007). The capability is for rehearsals and interviews where recording and assistance are agreed, uses ordinary OS permissions, and claims nothing about undetectability.

**Unverifiable here.** ScreenCaptureKit permissions, on-device speech and a real call workload cannot be exercised in the build environment. They are recorded as unverified, and a protocol-conformant fixture companion carries the conformance tests. The vendored on-device model is a browser-hosted, text-only engine by source inspection and is not assumed to provide speech, vision or coding.

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
- **Cons:** a restart or hot reload can double-dispatch; the host would own a continuous loop.
- **Why not:** it conflicts with placement beside the agent-job loop and with ADR-0007's worker boundary.

### Option D — Put session columns on the Interview, or let the companion import `interview-contracts`
- **Pros:** fewer records and no new package.
- **Cons:** destroys the three-concept split; couples the companion to private Interview schemas and blocks reuse by another product (OBJ-6).
- **Why not:** a session is bounded and short-lived, an Interview is durable, and the wire protocol has two independent consumers and its own versioning, which is what ADR-0003 requires for a new package.

## Consequences

**Positive:**
- A resent observation, a restarted worker, a late result, a pause and an end each have a defined, testable outcome (OBJ-5).
- The neutral core and wire contract can serve another product (OBJ-6), and coding agents can drive the same routes (OBJ-4).
- No new infrastructure beyond one package and one app.

**Negative:**
- The fence needs a session lease and a named worker policy; the migration contract belongs to ADR #2.
- The worker depends on gateway availability, which may force a shared factory and approach the scope checkpoint (ADR-0002).
- The core's purity rests on a new directory-scoped boundary check; the companion's boundary needs a manifest and source scan because Swift is outside pnpm.
- Sharing the worker process shares a failure domain; restart safety rests on the fence.

**Follow-on work:**
- ADR #2: private data, actor-level row security, retention, locality and untrusted-input rules, and the exact migration.
- Decide wake mechanism (poll or database notification), credential lifetime and renewal, and the fast-path latency budget measured at real timing and 4x.
- Decide whether fencing is later retrofitted onto agent-job writes.

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]]
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]]
- [[research/concepts/interview-domain-model]]
- [[research/references/ai-execution-boundaries]]
