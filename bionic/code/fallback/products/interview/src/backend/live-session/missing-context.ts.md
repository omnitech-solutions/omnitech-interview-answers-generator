# products/interview/src/backend/live-session/missing-context.ts

_Source: `products/interview/src/backend/live-session/missing-context.ts` (header-comment fallback)_

What a screen-based draft says it could not see (constraints, examples, ...).
Display metadata only: nothing branches on it, it is never a claim, and it is
never logged. Lenient by design: a malformed field or entry is dropped, never
the whole draft (and never a read).
