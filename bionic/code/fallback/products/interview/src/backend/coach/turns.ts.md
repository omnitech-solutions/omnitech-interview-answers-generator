# products/interview/src/backend/coach/turns.ts

_Source: `products/interview/src/backend/coach/turns.ts` (header-comment fallback)_

When the coach acts.

PROBLEM: speech arrives as fragments of one to ten words, a question can
take fifteen seconds to ask, and the person being coached can read a note
only at certain moments. Acting on a pause alone acts on half a question;
acting on every pause calls a model every few seconds.
STRATEGY: the unit is a TURN (everything one side says before the other
side speaks), not a pause. The coach acts once per turn of the interviewer,
at the earliest moment the turn can be told to be over, and looks at the
candidate's own answer only now and then. This file is that decision as a
pure function of what has been heard and the clock: no model, no I/O, so it
can be replayed over a recorded call and its every choice explained.
COMPLEXITY: O(new lines) per decision.
