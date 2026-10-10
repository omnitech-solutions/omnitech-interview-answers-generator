# apps/agent-worker/src/flagged-loop.test.ts

_Source: `apps/agent-worker/src/flagged-loop.test.ts` (header-comment fallback)_

A worker loop that follows the behaviour flags: built from the environment
alone when Settings cannot change anything, and otherwise built from what
Settings stored (read from the Studio's API with the API token) and built
again when that changes, with the host's own variables always winning.
