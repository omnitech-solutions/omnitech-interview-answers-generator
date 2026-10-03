# products/interview/src/backend/live-session/code-states.ts

_Source: `products/interview/src/backend/live-session/code-states.ts` (header-comment fallback)_

The three DISTINCT states of coding assistance (ADR-0011, plan #2 D6), derived
from observed facts and never collapsed into one "verified" flag:

generated      a structured solution was validated against the closed
schema and is being published;
testsPassed    the runner exited 0, did not time out, reported at least one
test and EVERY reported test passed (a skipped test is not a
pass);
fullyVerified  testsPassed AND every stated constraint of the task revision
has its OWN distinct NAMED test that passed AND the syntax
check was clean. It means "every constraint has its own
passing named test", NOT that the tests are adequate: the
runner reports no assertion counts, so an empty test is not
distinguishable here and the person must still review them.

Tests can pass while fullyVerified is false (a constraint no test names, a
syntax check that was not run). `reasons` is a code list that says why a state
is false; it never carries a model-controlled string.
