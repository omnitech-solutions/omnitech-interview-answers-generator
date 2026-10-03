# products/interview/src/backend/live-session/hardening/canary.test.ts

_Source: `products/interview/src/backend/live-session/hardening/canary.test.ts` (header-comment fallback)_

Hardening case 8 (PB-0002 slice 3): the no-content logging canary over the
WHOLE path, including the fixture companion. One unique string is planted
as spoken text, as a screenshot window label, in a refused message, and in a
failing model's error. It travels companion -> real routes -> real processor
-> purge. Everything the process could emit (console, stdout/stderr, traces,
the companion's visible state, every server answer and the tombstone) is
then searched for it, and a POSITIVE CONTROL proves the same search catches a
deliberate leak on each sink.
