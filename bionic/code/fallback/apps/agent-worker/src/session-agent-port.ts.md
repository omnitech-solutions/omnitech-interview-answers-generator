# apps/agent-worker/src/session-agent-port.ts

_Source: `apps/agent-worker/src/session-agent-port.ts` (header-comment fallback)_

The worker's implementation of the gateway's existing AgentExecutionPort for
Active Session actions (ADR-0016 Decision 1-3). It wraps an
AgentRuntimeAdapter and nothing else: no coordinator, queue or conversation
store. Every attempt is tool-less, runs with fresh context in its own
ephemeral provider home, stages screenshots in a private directory that is
removed when the attempt settles, and reports only typed error codes.

Interim wrapper: ships DISABLED (selected by an explicit config flag in
session-gateway.ts) and is deliberately thin, because PB-0003's shared
worker executor will replace this body (ADR-0014). Keep the exported shape
(the port, `sweep`, `purge`) and the tests; swap the internals.
