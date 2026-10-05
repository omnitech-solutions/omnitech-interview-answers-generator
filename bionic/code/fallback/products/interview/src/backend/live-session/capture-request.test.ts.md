# products/interview/src/backend/live-session/capture-request.test.ts

_Source: `products/interview/src/backend/live-session/capture-request.test.ts` (header-comment fallback)_

Capture now on a disposable PostgreSQL as the member role (requires Docker,
like the other session suites): the owner's one-shot request reaches the
companion only as `control.capture`, is fulfilled only by a snapshot naming
its exact id (the analyze input is created in the snapshot's own
transaction), and every other snapshot stays a plain snapshot. Also the
refusals, replacement, dedup, expiry, the purge and the two routes.
