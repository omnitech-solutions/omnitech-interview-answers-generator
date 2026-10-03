# products/interview/src/backend/rehearsal/session-hints.test.ts

_Source: `products/interview/src/backend/rehearsal/session-hints.test.ts` (header-comment fallback)_

Rehearsal hints derived from Active Session assistance (ADR-0012
rule:strict-rehearsal-no-assistance, rule:assistance-counts-as-hints,
rule:no-second-scorecard, rule:tombstone-keeps-hint-count). On a disposable
PostgreSQL as the application's non-owner role:
- a strict start forces live assistance off; a non-strict session's shown
drafts are counted as hints on the session row (and survive the purge);
- the scorecard save derives the hint count on the server from the owner's
own sessions with the run id, adds it to the reveals cost, and does not
store it as reveals;
- the session code never writes rehearsal_sessions.
