# products/interview/src/backend/live-session/repositories/purge.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/purge.repository.ts` (header-comment fallback)_

Every statement of the Active Session purge. Raw parameterised SQL moved
verbatim from session-purge.ts: delete chains with RETURNING, catalog reads
and the tombstone are PostgreSQL-specific and safety-critical (the purge
deletes user data), so none is rewritten in the builder. The caller owns the
transaction and the app.session_purge setting; these functions make no
decision, throw nothing and log nothing.
