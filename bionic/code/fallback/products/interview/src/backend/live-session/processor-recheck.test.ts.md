# products/interview/src/backend/live-session/processor-recheck.test.ts

_Source: `products/interview/src/backend/live-session/processor-recheck.test.ts` (header-comment fallback)_

The standing re-check just before a dispatch's first gateway call (S2): a
session paused between the action being recorded and the call is never sent
to a model, and its action is suppressed as session_paused.
