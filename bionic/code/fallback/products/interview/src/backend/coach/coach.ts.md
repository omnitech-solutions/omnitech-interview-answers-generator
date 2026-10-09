# products/interview/src/backend/coach/coach.ts

_Source: `products/interview/src/backend/coach/coach.ts` (header-comment fallback)_

The live coach: it reads the conversation as it arrives and puts a note in
front of the person when one would help.

PROBLEM: the person can read a few lines at a glance and no more, while the
conversation never stops. STRATEGY: one model call at a time, made only
when something worth a note has been said and the speaker has paused; the
model may answer with silence; a note is posted as it is written, as
revisions of one note, so it is on screen within the first sentence.
COMPLEXITY: O(lines held) per tick; at most LINES_HELD lines are held.
