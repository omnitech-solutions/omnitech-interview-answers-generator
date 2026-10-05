# products/interview/src/backend/live-session/stored-text-bounds.test.ts

_Source: `products/interview/src/backend/live-session/stored-text-bounds.test.ts` (header-comment fallback)_

Two small read/write safeguards, no database: a stored display that is a
malformed string reads as no display (never a throw), and a bounded runner
text never ends in half a surrogate pair.
