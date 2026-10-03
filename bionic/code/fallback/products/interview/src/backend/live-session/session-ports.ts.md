# products/interview/src/backend/live-session/session-ports.ts

_Source: `products/interview/src/backend/live-session/session-ports.ts` (header-comment fallback)_

The database-backed ports of the session processor: the cross-tenant claim
(session-claim.ts, the one file that sets app.session_worker), the fenced
writes, the owner-checked reads and the purge, composed over the real
PlatformDatabase. The processor itself knows only the port interfaces.
