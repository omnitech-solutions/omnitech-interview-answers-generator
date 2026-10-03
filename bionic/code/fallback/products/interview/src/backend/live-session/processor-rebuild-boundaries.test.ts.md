# products/interview/src/backend/live-session/processor-rebuild-boundaries.test.ts

_Source: `products/interview/src/backend/live-session/processor-rebuild-boundaries.test.ts` (header-comment fallback)_

A rebuilt run must reach the same utterance boundaries, task ids and task
revisions the live run reached (ADR-0011 restart safety): a stored action
remembers the segments its revision rests on, so a handover never merges an
answered question into the next one, never restarts a corrected task at
revision 1, and never drops a question as a duplicate. Real processor over
a disposable PostgreSQL, a fake gateway and a virtual clock.
