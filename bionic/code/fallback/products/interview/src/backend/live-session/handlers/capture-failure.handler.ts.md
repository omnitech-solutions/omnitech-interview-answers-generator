# products/interview/src/backend/live-session/handlers/capture-failure.handler.ts

_Source: `products/interview/src/backend/live-session/handlers/capture-failure.handler.ts` (header-comment fallback)_

The companion's report that it could not capture for one request: closed
code, correlated by id, content-free. It is accepted in any capturing state
(a paused or ended session answers with its standing) and changes only the
matching pending request. Not spaced: only the first report for a request
writes, and a repeat or a stranger's id changes nothing.
