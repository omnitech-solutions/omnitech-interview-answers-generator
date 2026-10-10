# products/interview/src/backend/live-session/domain/session-policy.ts

_Source: `products/interview/src/backend/live-session/domain/session-policy.ts` (header-comment fallback)_

Who may ingest, when a session takes a message, and what the answer says of
the session's standing. Pure: the locked row (with the database clock it was
read with), the limits and the message come in; a decision goes out.
