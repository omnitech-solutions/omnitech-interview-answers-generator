# apps/capture-companion/src/clock.ts

_Source: `apps/capture-companion/src/clock.ts` (header-comment fallback)_

Time is injected so backoff, heartbeats and the replayer run on a virtual
clock in tests and on the system clock in a real companion.
