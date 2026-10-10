# products/interview/src/backend/live-session/handlers/capability.handler.ts

_Source: `products/interview/src/backend/live-session/handlers/capability.handler.ts` (header-comment fallback)_

A capability report is the companion's own local readiness (speech support
and permission states, never content). It is accepted before capture starts
(a created or paused session) and while active, replaces the owner's latest
report, and is spaced like a heartbeat.
