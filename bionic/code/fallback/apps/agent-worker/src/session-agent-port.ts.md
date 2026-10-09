# apps/agent-worker/src/session-agent-port.ts

_Source: `apps/agent-worker/src/session-agent-port.ts` (header-comment fallback)_

The AI engine's provider for Active Session actions on an agent runtime
(ADR-0016 Decision 1-3, ADR-0037). It wraps an AgentRuntimeAdapter and
nothing else: no coordinator, queue or conversation store. Every attempt is tool-less, runs with fresh context and no persisted
history (Codex in its own per-attempt home), stages screenshots in a private directory that is
removed when the attempt settles, and reports only typed error codes.

The runtimes are PB-0003's worker-owned adapters (Codex App Server, pooled
Claude queries). The worker has no reusable bounded-execution helper (its
loop in index.ts is bound to the agent-job repository), so admission,
deadline, cancel and the one terminal outcome stay here.
