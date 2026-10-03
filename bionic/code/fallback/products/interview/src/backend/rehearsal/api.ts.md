# products/interview/src/backend/rehearsal/api.ts

_Source: `products/interview/src/backend/rehearsal/api.ts` (header-comment fallback)_

[SAFETY] [DOMAIN] The hint count is derived here, never taken from the
client (rule:assistance-counts-as-hints, rule:no-second-scorecard). It reads
only this member's own Active Session rows for the run id, tombstones
included because a purge keeps the count (rule:tombstone-keeps-hint-count);
row security pins tenant and actor, and the query repeats both. A run id
derives ONCE: a later save for the same run id is refused, decided under a
per-run advisory lock so two racing saves cannot both count. A strictness
claim that disagrees with the matching session is refused; when no session
matches, nothing is counted and nothing is refused.
