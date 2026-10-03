# products/interview/src/backend/live-session/session-purge.test.ts

_Source: `products/interview/src/backend/live-session/session-purge.test.ts` (header-comment fallback)_

The complete session purge (rule:complete-purge-except-retained-drafts) on a disposable
PostgreSQL as the member role: observations, screenshot artifacts and
payloads, actions, jobs with events, artifacts and payloads are all deleted in
one transaction; the final check reads the catalog and refuses to tombstone
when a table that references a session or a job is not covered; the purge is
idempotent and a crash resumes at the next sweep. The relay rows of the
on-device model are out of scope this loop: none exist yet.
