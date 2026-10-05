# apps/agent-worker/src/session-agent-port.integration.test.ts

_Source: `apps/agent-worker/src/session-agent-port.integration.test.ts` (header-comment fallback)_

Real-provider checks of the session agent port (ADR-0016). Skipped unless
ACTIVE_SESSION_AGENT_INTEGRATION=claude-code|codex names a runtime that is
signed in on this machine. The text case sends a fixed trivial prompt and
asserts only the shape of the result. The image case sends a synthetic,
non-private picture of the words "BANANA 42" and asserts the provider read
them, tool-less, through the same worker port and real adapters.
