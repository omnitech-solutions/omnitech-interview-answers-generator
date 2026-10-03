# products/interview/src/frontend/studio/live/session-test-server.ts

_Source: `products/interview/src/frontend/studio/live/session-test-server.ts` (header-comment fallback)_

A scripted stand-in for the Active Session routes, for store and view tests:
handlers by "METHOD /path" (the base and any query stripped), and a record
of every call so a test can count reads. Responses are real Response
objects, so the client's parsing is exercised too.
