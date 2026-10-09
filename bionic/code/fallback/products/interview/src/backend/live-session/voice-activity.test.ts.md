# products/interview/src/backend/live-session/voice-activity.test.ts

_Source: `products/interview/src/backend/live-session/voice-activity.test.ts` (header-comment fallback)_

Voice activity from a session's audio sources, through the ingest route on a
disposable PostgreSQL as the member role (the harness of routes.test.ts):
the session credential is the only principal; a device-only session, a
Studio with the switch off, a paused session and an unregistered source tell
the coach nothing; nothing is stored; and, end to end, a synthetic voice run
through the shared detector makes the coach's transcript feed say who is
speaking, until the voice stops or the source goes quiet.
