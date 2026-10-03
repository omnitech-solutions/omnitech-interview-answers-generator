# products/interview/src/backend/live-session/processor-fencing.test.ts

_Source: `products/interview/src/backend/live-session/processor-fencing.test.ts` (header-comment fallback)_

Lease, fence, pause, end, isolation and cross-user behaviour of the session
processor on a disposable PostgreSQL: two processors on one session (an
older fence's late publish is refused while its successor publishes; a
restarted worker outranks its earlier self), pause and end during in-flight
generation (the late result is not published and jobs are cancelled), purge
on end, per-session error isolation, and the same-tenant cross-user case.
