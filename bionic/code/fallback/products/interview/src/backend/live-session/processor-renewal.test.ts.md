# products/interview/src/backend/live-session/processor-renewal.test.ts

_Source: `products/interview/src/backend/live-session/processor-renewal.test.ts` (header-comment fallback)_

Bounded lease renewal (ADR-0011): a session whose renewals keep throwing is
dropped after maxRenewFailures consecutive failures, writes nothing, and a
renewal that answers resets the count. In-memory ports; no database.
