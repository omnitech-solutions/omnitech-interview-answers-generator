# products/interview/src/backend/live-session/session-job-policy.test.ts

_Source: `products/interview/src/backend/live-session/session-job-policy.test.ts` (header-comment fallback)_

A tightened (device-only) session can neither create nor resume a remote
agent job (S5-2): the lock query of createSessionJob and the resume guard
both read the session's processing policy under the session-row lock, so a
tighten between the dispatch's last check and the write is still refused.
