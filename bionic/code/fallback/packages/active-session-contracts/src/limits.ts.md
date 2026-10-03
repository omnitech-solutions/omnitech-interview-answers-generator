# packages/active-session-contracts/src/limits.ts

_Source: `packages/active-session-contracts/src/limits.ts` (header-comment fallback)_

Frozen ingest limits (rule:bounded-ingest). Sized for the recruiter-screen
profile: a question every 1-3 minutes, a 30-90 second answer window, and a
session of a few hours. Every limit is checked at ingest and refused with a
stable code, never truncated.
