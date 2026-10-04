# apps/agent-worker/src/session-agent-port.integration.test.ts

_Source: `apps/agent-worker/src/session-agent-port.integration.test.ts` (header-comment fallback)_

Real-provider check of the session agent port (ADR-0016). Skipped unless
ACTIVE_SESSION_AGENT_INTEGRATION=claude-code|codex names a runtime that is
signed in on this machine. It sends a fixed trivial prompt and asserts only
the shape of the result, never its content.
