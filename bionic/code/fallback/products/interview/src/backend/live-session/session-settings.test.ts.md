# products/interview/src/backend/live-session/session-settings.test.ts

_Source: `products/interview/src/backend/live-session/session-settings.test.ts` (header-comment fallback)_

The three Active Session settings are each set by one small owning module.
A fake client records the statements, so no database is needed here; the
security suite (db/live-session-security.test.ts) runs them for real.
