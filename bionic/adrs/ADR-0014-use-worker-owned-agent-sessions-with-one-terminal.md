---
id: ADR-0014
title: "Use worker-owned agent sessions with one terminal outcome"
status: Accepted
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: 2026-10-03
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [ai, agents, runtime, reliability, streaming]
related_briefs: []
related_research: [references/ai-execution-boundaries]
governs:
  - domain: agent-runtime
    rule: "Each logical execution publishes exactly one terminal outcome; each claimed attempt publishes at most one closing outcome, including an awaiting-input suspension."
    scope: packages/agent-runtime-contracts, packages/agent-runtime-*, and apps/agent-worker
    handle: ADR-0014/one-terminal-outcome
    provenance: authored
  - domain: agent-runtime
    rule: "Each closing event, matching job status, and applicable result reference commit atomically under a claim fence or row lock; a lost claim publishes nothing further."
    scope: apps/agent-worker and agent-job repositories
    handle: ADR-0014/fenced-terminal-publish
    provenance: authored
  - domain: agent-runtime
    rule: "The worker bounds provider processes, and each persistent session is bound to one tenant, actor, job, and runtime profile; only the current lease claim may resume it."
    scope: apps/agent-worker and packages/agent-runtime-*
    handle: ADR-0014/worker-owned-isolated-sessions
    provenance: authored
  - domain: agent-runtime
    rule: "Provider history and model-readable files are isolated per owner; a session cannot read another tenant's history or shared credentials."
    scope: apps/agent-worker and packages/agent-runtime-*
    handle: ADR-0014/provider-history-isolation
    provenance: authored
  - domain: agent-runtime
    rule: "Codex App Server may replace the SDK only through worker-owned private stdio, with a pinned protocol, parity checks, and a measured same-workload benefit."
    scope: packages/agent-runtime-codex
    handle: ADR-0014/codex-transport-parity
    provenance: authored
  - domain: agent-runtime
    rule: "Claude uses only the installed TypeScript Agent SDK's supported session lifecycle; isolated structured jobs remain one-shot, and persistent sessions require measured benefit and safe closure."
    scope: packages/agent-runtime-claude
    handle: ADR-0014/claude-supported-lifecycle
    provenance: authored
---

# ADR-0014 — Use worker-owned agent sessions with one terminal outcome

## Context

Studio runs Codex and Claude Code through `AgentRuntimeAdapter` in the agent worker. The shared event contract has terminal `completed` and `failed` events but does not state their cardinality. The Codex adapter can report a failed turn and then report completion when the stream ends. The Claude adapter can report a result and then report failure if the iterator subsequently throws. A consumer that stops at the first terminal event can conceal either violation.

The current Codex SDK starts a CLI execution for each turn. OpenAI documents App Server as a long-lived, thread-and-turn protocol, but the installed Codex SDK does not expose an App Server client. The installed TypeScript Claude Agent SDK exposes `query()` and session resume, not the Python `ClaudeSDKClient` name in the original proposal. Agent-worker already bounds job concurrency and owns lease and cancellation behavior. [[research/references/ai-execution-boundaries]] describes the existing execution boundary; ADR-0007 remains Proposed, while this repository's `AGENTS.md` already requires the worker-only and no-content-logging boundaries.

## Decision

An execution is the logical job lifecycle from start through one final `completed` or `failed` outcome; `failed` with `error.code: "cancelled"` maps to durable `cancelled` status. One execution may contain several claimed worker attempts. An attempt is a `run` or `resume` adapter invocation under one lease claim and publishes at most one closing event: `completed`, `failed`, or `awaiting-input`. While it owns the lease, an attempt must close with one such event; lease loss supersedes the attempt without a committed close. `awaiting-input` closes that invocation but suspends the logical execution without ending it; a later explicit resume continues the same execution in a new attempt. The reader-visible stream groups events by execution ID and attempt/lease epoch, selecting only the committed closing event from the current claim. The final history contains exactly one terminal outcome per execution. A provider stream that closes without an outcome while the claim is held becomes `failed`; an exception after a closing outcome cannot append another one. A lost claim publishes nothing further; its new owner completes recovery with a terminal outcome, never fabricating a result under the stale claim.

For every closing outcome, including `awaiting-input`, the job repository commits the event, matching status, and applicable result reference atomically. A live claimant is fenced by its lease epoch. Cancellation of an unclaimed, queued, or suspended job uses a row-locked compare-and-set finalization with the same execution identity; it cannot require a live lease. A cancellation that wins this ordering cannot leave a stored `completed` event; a completion that wins cannot acquire a later `failed` event for the same execution. Product and worker readers use the committed outcome, not a provisional provider event, as authority.

The worker owns lifecycle policy and concurrency bounds; provider adapters own their transport and process handles. A worker process may host several provider sessions, but each thread/session belongs to one tenant, actor, job, and runtime profile, with those bindings checked against the stored job and current lease claim before every resume. No product or tenant input can call thread listing, history, or arbitrary provider RPC. Only an explicitly resumed `awaiting-input` job may resume its owner-bound provider session after worker restart if the provider confirms it; otherwise that attempt fails without blending histories. An expired lease on a `running` document job instead reclaims and runs the job from the beginning, as ADR-0010 requires: its stale provider session is quarantined and cannot contribute output. Completion, cancellation, lease loss, or retention expiry releases the live process handle. The existing explicit `requestResume` path for failed or cancelled jobs remains authorized by the tenant and actor, with an active-session guard for private jobs; it starts a new logical execution with a fresh provider session and never silently revives a cancellation or reuses its history.

The existing shared worker home is a privacy hazard: a model tool may be able to read provider history or credentials outside its job. Provider state and history must live in a root scoped to one tenant, actor, and job; model tools must be denied the worker's shared home and credentials. Existing local authentication remains available to the provider through a separate, model-inaccessible channel. This is a required isolation postcondition, not permission to copy or edit credentials. Negative file-read tests must prove that another tenant's history, another job's history under the same actor, and shared credentials are inaccessible; if the installed SDK cannot enforce the boundary, persistent reuse and migration stay disabled and the current SDK exposure is reported as an unresolved security blocker. The current no-content-logging rule remains; protocol stderr cannot expose content or credentials by default. Neither transport may broaden user-controlled CLI arguments, environment, directories, tools, or permissions. Credential changes require separate authorization.

Codex App Server is an optional worker-owned transport over private stdio, never a public listener or tenant-controlled endpoint. It may replace the SDK path only after a version-pinned protocol proves structured output, streaming, interruption, recovery after process restart, local authentication, thread ownership, and terminal behavior. Before measurements, the migration plan selects either first response or turn completion as its primary latency endpoint. A paired same-model, same-input benchmark must then show at least a 20% median reduction on that endpoint over ten runs, with no failure increase or more than 10% p95 regression. The measurements, costs, and chosen threshold are recorded before migration. Until both parity and benefit pass, the SDK path remains supported; a failed parity check blocks migration instead of triggering a silent fallback within an execution.

Claude retains the installed TypeScript Agent SDK `query()` path for isolated structured jobs. Its supported resume and streaming-input lifecycle may back a persistent session only after owner isolation, closing behavior, failure recovery, and same-workload benefit are measured. The worker releases live query handles on completion, cancellation, and lease loss; it does not assume the Python `ClaudeSDKClient` API exists in TypeScript.

## Alternatives Considered

### Keep both current adapters without a shared terminal rule

- **Benefit:** No migration risk or extra process lifecycle.
- **Why not:** Both adapters have reachable contradictory-terminal paths, and consumers cannot rely on a coherent completion contract.

### Replace both providers with one custom persistent protocol

- **Benefit:** Similar lifecycle code for both providers.
- **Why not:** Claude's installed TypeScript SDK and Codex App Server expose different supported mechanisms. A common vendor protocol would add a compatibility layer and auth risk without improving the product boundary.

### Switch Codex and Claude to persistent transports immediately

- **Benefit:** Potentially less startup time and easier multi-turn continuity.
- **Why not:** The installed packages and local authentication path have not yet demonstrated parity or a same-input latency benefit. A transport switch before those checks would trade a known defect for unmeasured failure modes.

## Consequences

**Positive:** Adapter consumers receive one coherent outcome per claimed attempt and a matching durable status. The worker remains the lifecycle and privacy boundary. Persistent transport work has explicit, testable entry criteria.

**Negative:** Codex may continue to pay per-turn startup cost until App Server parity and benefit pass. Claude's isolated structured jobs will still start a query each time. Attempt identity, fenced persistence, provider-boundary tests, and version tracking add maintenance.

**Follow-on:** The runtime development loop must test terminal races and provider process death, measure one-shot and persistent paths on the same input, and report which live provider behaviors remain unobserved.

## References

- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] (Proposed)
- [[adrs/ADR-0010-write-documents-in-a-few-parallel-calls-on-any-lan]]
- [[research/references/ai-execution-boundaries]]
- `packages/agent-runtime-contracts/src/index.ts`; `packages/agent-runtime-codex/src/index.ts`; `packages/agent-runtime-claude/src/index.ts`; `apps/agent-worker/src/index.ts`
- [OpenAI Codex App Server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Anthropic Agent SDK migration boundary](https://platform.claude.com/docs/en/managed-agents/migration)
