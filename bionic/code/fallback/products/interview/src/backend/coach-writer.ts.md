# products/interview/src/backend/coach-writer.ts

_Source: `products/interview/src/backend/coach-writer.ts` (header-comment fallback)_

Who may write the coach's notes right now.

PROBLEM: more than one coach can be running (the built-in one in the
worker, a desktop agent coaching by hand, a second worker after a restart),
and each can only cancel its own work. A note that left a coach before it
was told to stand down still arrives. STRATEGY: the Studio, which takes the
notes, is the one place that knows who holds the pen. A coach claims it and
is given an epoch; every note it posts names that claim, and a note from a
claim that is no longer the current one is refused here, whatever its
writer believes. A claim lapses unless renewed, so a coach that died does
not hold the pen for ever.
A note posted with no claim at all (a person, a script) is always taken.
