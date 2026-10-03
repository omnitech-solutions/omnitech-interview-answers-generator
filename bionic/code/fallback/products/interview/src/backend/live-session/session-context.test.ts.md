# products/interview/src/backend/live-session/session-context.test.ts

_Source: `products/interview/src/backend/live-session/session-context.test.ts` (header-comment fallback)_

The session context reader on a disposable PostgreSQL as the application
role (fixture_member, forced row security): the pinned profile revision is
read (not a newer one), its hash is re-verified (a mismatch makes the context
unavailable, never a stale answer), another member's profile or draft is
never readable through a session row that names it, and the linked briefing
draft's employer material and candidate preferences are read with the draft
revision recorded.
