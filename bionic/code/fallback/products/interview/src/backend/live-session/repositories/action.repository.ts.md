# products/interview/src/backend/live-session/repositories/action.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/action.repository.ts` (header-comment fallback)_

Persistence of session_actions (the dispatch ledger, the in-flight draft's
progress, the published result) and the counters on the session row that the
publish moves. No decisions here: callers decide, this file reads and writes.
