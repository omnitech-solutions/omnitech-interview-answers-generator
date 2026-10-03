# products/interview/src/backend/live-session/trace.test.ts

_Source: `products/interview/src/backend/live-session/trace.test.ts` (header-comment fallback)_

The id-only trace sink: the event keeps ids, fence, profile, locality,
duration, outcome and byte counts, and the sink replaces anything that is not
id- or code-shaped, so content cannot ride out in a line.
