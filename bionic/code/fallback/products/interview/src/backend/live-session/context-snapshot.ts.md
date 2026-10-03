# products/interview/src/backend/live-session/context-snapshot.ts

_Source: `products/interview/src/backend/live-session/context-snapshot.ts` (header-comment fallback)_

The pinned context snapshot of an Active Session (ADR-0011/0012): the
approved experience matrix revision, the linked draft's employer context and
the candidate's own preferences, cut into small citable sources.

Pure data in, data out: no database, no gateway, no clock. The model may only
cite what is in here (claims.ts verifies every reference against this
snapshot), so the sources are WHOLE texts with deterministic ids. A bound
shrinks the set by dropping whole sources; a source is never cut mid-text,
because a truncated quote could not verify.

Errors carry a code only, never content.
