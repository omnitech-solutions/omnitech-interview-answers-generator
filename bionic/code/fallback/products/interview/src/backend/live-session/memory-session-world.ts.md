# products/interview/src/backend/live-session/memory-session-world.ts

_Source: `products/interview/src/backend/live-session/memory-session-world.ts` (header-comment fallback)_

TEST SUPPORT, not for production hosts (exported only through the
`session-testing` entry): an in-memory session world for the processor's
ports, with the same fenced rules as the database writes (holder fence and
lease, status and revision eligibility through the neutral core, dispatch
dedup, suppression on a stale publish). It lets a host's test drive the REAL
processor, REAL gateway and REAL agent port end to end without a database.

Its fenced rules are the neutral core's OWN functions (canPublish,
decideDispatch, holderStanding, revisionStanding), imported below, never a
copy of them; memory-session-world.test.ts pins that, so a host's end-to-end
result means what the database path means.

What it does not do: the Workspace draft write of a coding publish (a
database effect, covered by the database suites) and row security.
