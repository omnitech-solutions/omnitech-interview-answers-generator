# products/interview/src/backend/live-session/hardening/retention.test.ts

_Source: `products/interview/src/backend/live-session/hardening/retention.test.ts` (header-comment fallback)_

Hardening case 7 (PB-0002 slice 3): retention and COMPLETE purge for each
retention mode. A session is built the way a call builds it - a fixture
companion through the real routes (transcripts, a screenshot with pixels), the
real processor (a prose draft, a solution and the session-owned Workspace
draft), plus a private job with its events, artifact and payload rows. Then
the retention sweep (the real processor's sweep, as the worker runs it)
decides: delete-at-end purges at once, thirty-days only after thirty days,
until-deleted only when the owner deletes. A purged session leaves nothing
but a content-free tombstone.
