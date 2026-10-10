# products/interview/src/backend/live-session/handlers/heartbeat.handler.ts

_Source: `products/interview/src/backend/live-session/handlers/heartbeat.handler.ts` (header-comment fallback)_

A content-free heartbeat updates the contact stamp so resume is observable. A
companion that reports it stopped capturing pauses the session (never ends
it); every answer carries the control state. Heartbeats are spaced by
minHeartbeatIntervalMs against the last contact: a closer one is refused
rate_limited and stores nothing. A stop report (capturing: false) is never
delayed by the spacing (rule:pause-only-credential-stop).
