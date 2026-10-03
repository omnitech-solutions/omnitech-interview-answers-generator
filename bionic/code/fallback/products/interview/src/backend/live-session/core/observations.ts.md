# products/interview/src/backend/live-session/core/observations.ts

_Source: `products/interview/src/backend/live-session/core/observations.ts` (header-comment fallback)_

Observation ordering and dedup (rule:idempotent-observation). The key is
(sourceId, eventId); a resend returns the ORIGINAL acknowledgement unchanged.
Ordering is per source by `sequence`, tolerant of late arrival, and gaps are
recorded as state, never as tasks. Pure: the ledger is returned, not mutated.
