# products/interview/src/backend/live-session/session-tighten-jobs.test.ts

_Source: `products/interview/src/backend/live-session/session-tighten-jobs.test.ts` (header-comment fallback)_

Tightening a session to device-only cancels the agent jobs it already queued
(S5): the agent worker claims any queued job without a policy check, so a
remote job left queued would still launch after the owner asked for
device-only.
