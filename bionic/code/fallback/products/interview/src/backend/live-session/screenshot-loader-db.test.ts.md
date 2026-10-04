# products/interview/src/backend/live-session/screenshot-loader-db.test.ts

_Source: `products/interview/src/backend/live-session/screenshot-loader-db.test.ts` (header-comment fallback)_

The screenshot loader's SQL join on a disposable PostgreSQL as the member
role (requires Docker, like the other session suites): a stored snapshot is
loaded by its provenance id for the owner's ACTIVE session only; a paused
session is the retryable "closed" answer, and another owner's or another
tenant's id is refused as not found (ADR-0016 Decision 3).
