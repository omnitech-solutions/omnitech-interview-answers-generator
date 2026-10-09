# products/interview/src/backend/coach/reply.ts

_Source: `products/interview/src/backend/coach/reply.ts` (header-comment fallback)_

What the coach's model writes, and the note it becomes.

PROBLEM: a note must reach the window while it is still being written, and
a half-written JSON object cannot be shown. STRATEGY: the model writes one
labelled line per piece ("SAY: …"), so every completed line is a whole,
valid part of the note and the note so far can be posted as it grows.
