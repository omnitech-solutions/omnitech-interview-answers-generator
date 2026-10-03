# apps/agent-worker/src/session-options.test.ts

_Source: `apps/agent-worker/src/session-options.test.ts` (header-comment fallback)_

The Active Session loop's host wiring: the sandboxed test runner exists only
when the environment asks for it (ACTIVE_SESSION_CODE_RUNNER=docker), a
device-local declaration means nothing without it, and agent escalation is
opt-in and offers only typed, bounded profiles.
