# products/interview/src/backend/coach-notes.test.ts

_Source: `products/interview/src/backend/coach-notes.test.ts` (header-comment fallback)_

The coach's notes on disk: one file in the data directory, read on first
use, newest first, bounded, cleared on request, and never a reason for a
note not to reach the window. Each test has its own temporary directory.
