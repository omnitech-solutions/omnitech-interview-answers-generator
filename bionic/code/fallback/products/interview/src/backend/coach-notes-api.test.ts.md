# products/interview/src/backend/coach-notes-api.test.ts

_Source: `products/interview/src/backend/coach-notes-api.test.ts` (header-comment fallback)_

The coach notes over HTTP: a coach posts a note, the window reads the list,
and a revision older than the one held is refused with 409 and changes
nothing. The store here is the real one over a temporary file, never the
data directory.
