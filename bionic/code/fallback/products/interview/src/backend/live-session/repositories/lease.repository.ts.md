# products/interview/src/backend/live-session/repositories/lease.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/lease.repository.ts` (header-comment fallback)_

The lease and fence statements the job paths run on the session row. They
take the job store's own string-query transaction (not a tenant handle), so
they stay raw and verbatim. No decisions here: callers decide.
