# products/interview/src/backend/live-session/processor-slots.test.ts

_Source: `products/interview/src/backend/live-session/processor-slots.test.ts` (header-comment fallback)_

The two action slots (ADR-0016) through the REAL processor on a disposable
database with a held fake gateway: a spoken question is answered while a
coding action is still executing, a correction cancels the in-flight coding
and its old output can never publish, a failure in one slot settles only its
own action, and quiesce/close abort both slots.
