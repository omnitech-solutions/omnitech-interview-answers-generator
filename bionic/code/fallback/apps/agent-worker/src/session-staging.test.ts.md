# apps/agent-worker/src/session-staging.test.ts

_Source: `apps/agent-worker/src/session-staging.test.ts` (header-comment fallback)_

Staged-screenshot cleanup that needs no model and no runtime (ADR-0016):
the startup sweep, the post-purge idle sweep that spares a running attempt,
and dead processes' staging directories.
