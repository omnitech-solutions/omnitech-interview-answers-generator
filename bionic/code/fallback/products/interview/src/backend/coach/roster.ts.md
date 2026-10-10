# products/interview/src/backend/coach/roster.ts

_Source: `products/interview/src/backend/coach/roster.ts` (header-comment fallback)_

Who is on the panel, as the plan for the call says it.

PROBLEM: in a panel the coach should aim an answer at what the person who
asked is judging, and may say who asked. Both need the panel's names, and
the only place the person has written them is the plan, which is free text.
STRATEGY: one forgiving line of the plan is read as the roster:

panel: Priya (hiring manager), Marcus (staff engineer: reliability), Tom

The line starts with `panel:`, `panelists:`, `interviewers:` or
`who is there:` (any case; a leading "-", "*" or "#" is ignored). People are
separated by commas or semicolons; what a person judges follows the name in
brackets, or after " - " or ": ". A plan with no such line has no roster,
and everything works as it did for one interviewer.
[GUARD] The roster is read, never guessed: an entry that does not start
with a capitalised name of at most three words is left out.
