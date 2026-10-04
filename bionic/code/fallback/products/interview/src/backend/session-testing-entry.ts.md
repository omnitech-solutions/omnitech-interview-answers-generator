# products/interview/src/backend/session-testing-entry.ts

_Source: `products/interview/src/backend/session-testing-entry.ts` (header-comment fallback)_

Backend-only subpath `@omnitech/product-interview/session-testing`: TEST
SUPPORT for hosts that drive the REAL session processor over their own
gateway without a database (the agent worker's end-to-end tests). Nothing
here is used by a production host. It exports only what
apps/agent-worker/src/session-e2e-support.ts imports; widen it only when a
host test needs more.
