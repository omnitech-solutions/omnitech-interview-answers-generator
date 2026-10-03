# products/interview/src/backend/live-session/session-jobs.ts

_Source: `products/interview/src/backend/live-session/session-jobs.ts` (header-comment fallback)_

A session's agent jobs: finding them through the actions that name them, and
cancelling them with the actor-carrying cancel (ADR-0012 Agent jobs). The
session and the job stay separate records (rule:three-concept-split): the
session names a job only through an action row, and a job never carries
session identity.
