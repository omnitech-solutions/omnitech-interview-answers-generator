---
id: ADR-0014
title: "Use worker-owned agent sessions with one terminal outcome"
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
tags: [ai, agents, runtime, reliability, streaming]
related_briefs: []
related_research: [references/ai-execution-boundaries]
governs:
  - domain: agent-runtime
    rule: "Each agent execution emits exactly one terminal outcome after all accepted events, including failure, cancellation, and stream exceptions."
    scope: packages/agent-runtime-contracts and packages/agent-runtime-*
    handle: ADR-0014/one-terminal-outcome
    provenance: authored
  - domain: agent-runtime
    rule: "The agent worker owns bounded provider processes and sessions; no session or process may carry private context across tenants or independent jobs."
    scope: apps/agent-worker and packages/agent-runtime-*
    handle: ADR-0014/worker-owned-isolated-sessions
    provenance: authored
  - domain: agent-runtime
    rule: "A Codex App Server migration requires a pinned, tested protocol and parity for structured output, streaming, interruption, recovery, and local authentication before replacing the SDK path."
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

The shared runtime contract requires exactly one terminal outcome per execution. Success, failure, cancellation, stream exhaustion, and exceptions must be distinguished without contradictory terminal events. Consumers must not infer success merely because a provider stream closed. A terminal event closes that execution's event stream; later provider messages are ignored or treated as an internal diagnostic without private content.

The agent worker owns provider process and session lifecycles. It bounds concurrent executions, closes them on cancellation or lost lease, and keeps private context isolated by tenant and job. Products continue to use profiles through `AiExecutionGateway`; the adapter interface and worker-only execution boundary remain in place. Neither provider transport may broaden user-controlled CLI arguments, environment, directories, tools, or permissions, or log interview content by default.

Codex App Server is the target transport for persistent sessions. Migration is gated by a version-pinned protocol and demonstrated parity with the SDK path for structured output, streaming, interruption, recovery after process restart, local authentication, and terminal-event behavior. Until that evidence passes, the SDK path remains the supported implementation. A failed parity check blocks the migration; it is not hidden by a silent fallback within an execution.

Claude uses the installed TypeScript Agent SDK's supported `query()` lifecycle. Persistent streaming input is reserved for a session that benefits from multiple turns and can be closed safely; isolated structured document calls remain one-shot. No session is pooled across independent jobs or tenants. A persistent path must show a measured improvement on the same workload before becoming the default.

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

**Positive:** Adapter consumers receive one coherent terminal outcome. The worker remains the process and privacy boundary. Persistent transport work has explicit, testable entry criteria.

**Negative:** Codex may continue to pay per-turn startup cost until App Server parity passes. Claude's isolated structured jobs will still start a query each time. Provider-boundary tests and version tracking add maintenance.

**Follow-on:** The runtime development loop must test terminal races and provider process death, measure one-shot and persistent paths on the same input, and report which live provider behaviors remain unobserved.

## References

- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] (Proposed)
- [[adrs/ADR-0010-write-documents-in-a-few-parallel-calls-on-any-lan]]
- [[research/references/ai-execution-boundaries]]
- `packages/agent-runtime-contracts/src/index.ts`; `packages/agent-runtime-codex/src/index.ts`; `packages/agent-runtime-claude/src/index.ts`; `apps/agent-worker/src/index.ts`
- [OpenAI Codex App Server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Anthropic Agent SDK migration boundary](https://platform.claude.com/docs/en/managed-agents/migration)
