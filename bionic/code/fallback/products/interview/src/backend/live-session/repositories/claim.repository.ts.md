# products/interview/src/backend/live-session/repositories/claim.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/claim.repository.ts` (header-comment fallback)_

Every statement of the worker's cross-tenant claim and lease. Raw
parameterised SQL moved verbatim from session-claim.ts: the SKIP LOCKED claim
and the lease writes are PostgreSQL-specific and cross-tenant, so none is
rewritten in the builder. The caller (session-claim.ts) sets
app.session_worker and owns the transaction; these functions make no
decision, throw nothing and log nothing.
