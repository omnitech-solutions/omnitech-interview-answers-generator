# products/interview/src/backend/live-session/session-standing.test.ts

_Source: `products/interview/src/backend/live-session/session-standing.test.ts` (header-comment fallback)_

The standing verdict the agent port acts on after a capacity wait, without a
database: a paused or ended session and a failed read are RETRYABLE answers,
a session that is not remote-permitted is a final denial (ADR-0016).
