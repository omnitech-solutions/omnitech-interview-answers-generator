# packages/platform-storage/src/agent-job-repository.ts

_Source: `packages/platform-storage/src/agent-job-repository.ts` (header-comment fallback)_

A member's jobs: every read and write runs inside the job's tenant and as
an explicit actor, so a private job (ADR-0012 Agent jobs) is visible only
to its creator. A `null` actor is a caller with no user: it sees no private
row. Lock order for a session job is the session row, then the job row.
Raw by necessity: the engine's beforeInsert and guard hooks are handed this
transaction's pg client to lock the session row first, and an actorless
caller has no Drizzle handle (withTenant needs an actor). The statements
that decide anything are single compare-and-set updates on status.
