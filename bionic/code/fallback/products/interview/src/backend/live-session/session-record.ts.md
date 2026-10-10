# products/interview/src/backend/live-session/session-record.ts

_Source: `products/interview/src/backend/live-session/session-record.ts` (header-comment fallback)_

The session row as the repository reads it (repositories/session.repository.ts
locks and reads it), and the public view of it. The view never carries the
credential hash (rule:credential-storage).
