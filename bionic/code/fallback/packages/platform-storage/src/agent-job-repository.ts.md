# packages/platform-storage/src/agent-job-repository.ts

_Source: `packages/platform-storage/src/agent-job-repository.ts` (header-comment fallback)_

A member's jobs: every read and write runs inside the job's tenant and as
an explicit actor, so a private job (ADR-0012 Agent jobs) is visible only
to its creator. A `null` actor is a caller with no user: it sees no private
row. Lock order for a session job is the session row, then the job row.
