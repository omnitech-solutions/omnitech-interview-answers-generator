# products/interview/src/backend/coach-transcript-api.test.ts

_Source: `products/interview/src/backend/coach-transcript-api.test.ts` (header-comment fallback)_

The coach's transcript over HTTP: a session or a person adds lines, the
coach reads what follows its cursor, and a clear (of the transcript or of
the coach's notes) starts a new epoch. The notes store here is the real one
over a temporary file; the transcript is the process's own, in memory.
