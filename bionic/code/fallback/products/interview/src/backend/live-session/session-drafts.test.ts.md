# products/interview/src/backend/live-session/session-drafts.test.ts

_Source: `products/interview/src/backend/live-session/session-drafts.test.ts` (header-comment fallback)_

The session-owned Workspace draft on a disposable PostgreSQL as the member
role: the publish effect writes inside the fenced publish transaction behind
an expected-revision check, a conflict is an outcome that keeps the held
result on the action, a throwing effect rolls the publish back, a stale
revision never reaches the effect, and the purger deletes only the drafts the
session still marks (ADR-0012/complete-session-purge, ADR-0008).
