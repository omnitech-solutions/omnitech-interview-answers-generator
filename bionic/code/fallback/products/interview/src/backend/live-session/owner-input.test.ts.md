# products/interview/src/backend/live-session/owner-input.test.ts

_Source: `products/interview/src/backend/live-session/owner-input.test.ts` (header-comment fallback)_

Owner input on a disposable PostgreSQL as the member role (requires Docker,
like the other session suites): the DB-only `owner.input` kind has its own
source namespace, is exempt from the capture caps, validates its frozen
snapshot ids against the owner's own session, dedups on the request id, and
can never arrive on the capture wire (ADR-0016 Decision 4).
