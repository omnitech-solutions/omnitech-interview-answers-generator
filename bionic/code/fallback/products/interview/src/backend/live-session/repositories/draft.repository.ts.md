# products/interview/src/backend/live-session/repositories/draft.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/draft.repository.ts` (header-comment fallback)_

Persistence of the session-owned Workspace draft's row lock and its purge.
Raw: the draft table belongs to the assistant workspace, and the purge runs on
the purge transaction's own string-query client. No decisions here.
