# products/interview/src/frontend/studio/live/session-store.ts

_Source: `products/interview/src/frontend/studio/live/session-store.ts` (header-comment fallback)_

The session store: the Active Session as the browser knows it, independent of
every React component (plan #3 U3). It hydrates from the server, follows the
stream with the observation and action cursors, runs the owner's commands and
publishes immutable snapshots for useSyncExternalStore. Views come and go;
this outlives them, so a session survives navigation and a remount never
starts a second poll.

[SAFETY] The server record is authoritative: every command replaces the
session from the response. The credential from start or renewal is held in
`pairing` only. It is never written to storage, never logged, and is never
read back from the server.
