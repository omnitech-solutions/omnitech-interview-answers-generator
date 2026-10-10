# products/interview/src/backend/live-session/repositories/session.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/session.repository.ts` (header-comment fallback)_

Persistence of the session row and of what hangs directly on it: the
credential lookup, the row lock every write serializes on, the membership
re-check's read, the contact stamp and the status change. No decisions here:
callers decide, this file reads and writes.
