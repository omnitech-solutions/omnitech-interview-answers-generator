# products/interview/src/backend/live-session/hardening/pause-resume.test.ts

_Source: `products/interview/src/backend/live-session/hardening/pause-resume.test.ts` (header-comment fallback)_

An owner's pause and resume with a REAL companion over the real routes
(dev loop 4 review, MUST-FIX 1). Studio pauses an active session when a
heartbeat says capturing:false, so a companion that is paused by Studio must
not say it, or the owner's next resume is undone by the following heartbeat.
