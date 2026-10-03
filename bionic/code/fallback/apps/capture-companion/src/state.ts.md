# apps/capture-companion/src/state.ts

_Source: `apps/capture-companion/src/state.ts` (header-comment fallback)_

The visible state machine. The companion shows exactly one phase, chosen so
that nothing claims "listening" while a source is revoked, paused or the
speech check failed. It holds no content: only phases, source names and
fixed notice codes.
