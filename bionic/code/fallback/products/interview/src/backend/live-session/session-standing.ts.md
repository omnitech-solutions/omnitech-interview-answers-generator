# products/interview/src/backend/live-session/session-standing.ts

_Source: `products/interview/src/backend/live-session/session-standing.ts` (header-comment fallback)_

The standing check the worker's agent port runs after any capacity wait
(ADR-0016 Decision 1): the session must still be active and still allow
remote processing, read from the session row alone in the owner's scope. The
session id is the first segment of the dispatch's idempotency key, which the
processor builds from the claimed session; an unreadable key, an unknown
session or any read failure answers a typed verdict, never "permitted" (fail
closed).
