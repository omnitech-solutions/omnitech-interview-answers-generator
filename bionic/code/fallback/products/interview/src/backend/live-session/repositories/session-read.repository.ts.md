# products/interview/src/backend/live-session/repositories/session-read.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/session-read.repository.ts` (header-comment fallback)_

Every read behind the owner-checked read paths: the open session's id, the
observation and action rows, a task's screenshots, the pinned profile
revision, the session history page, and the action-changes page. Each takes
the open tenant transaction and the owner's scope, returns raw rows and
decides nothing; the use cases (session-reads.ts, session-pages.ts) own the
not-found refusal, the paging and the mapping. The statements are kept raw
because they use PostgreSQL-specific constructs (window ranks, array_agg,
unnest ... WITH ORDINALITY, correlated subqueries, row-value keysets,
to_char) that the query builder would only restate.
