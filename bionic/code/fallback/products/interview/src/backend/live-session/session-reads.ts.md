# products/interview/src/backend/live-session/session-reads.ts

_Source: `products/interview/src/backend/live-session/session-reads.ts` (header-comment fallback)_

Owner-checked read paths (rule:owner-checked-read-paths): streams, downloads,
context assembly and job results each open an actor-scoped transaction for the
session owner and read only owner-scoped data, so another same-tenant user
finds nothing. A session that is not the actor's reads as "not found", the
same as one that does not exist.
