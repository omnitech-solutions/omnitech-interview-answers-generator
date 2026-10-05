# products/interview/src/backend/live-session/session-pages-db.test.ts

_Source: `products/interview/src/backend/live-session/session-pages-db.test.ts` (header-comment fallback)_

The browser's action feed on a disposable PostgreSQL as the member role
(requires Docker, like the other session suites): `listActionChanges` runs
the real SNAPSHOT_EVENT_IDS SQL over stored rows, so the screenshots an
action rests on reach the browser as source and event ids only (in stored
order, never the spoken or owner-input ids), and a stored missing-context
list comes back sanitised on the action.
