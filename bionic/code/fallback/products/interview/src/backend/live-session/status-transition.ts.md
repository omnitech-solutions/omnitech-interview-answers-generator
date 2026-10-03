# products/interview/src/backend/live-session/status-transition.ts

_Source: `products/interview/src/backend/live-session/status-transition.ts` (header-comment fallback)_

Status changes of a locked session row, decided by the neutral core
(rule:owner-starts-and-resumes, rule:pause-only-credential-stop,
rule:owner-or-cap-ends). Only the owner starts or resumes; expiry and a
companion stop PAUSE; the owner or duration cap end. The caller holds the
row lock (lockSession) and commits;
jobs are cancelled only after the status flip commits (rule:pause-end-
suppression: status first, then cancellation).
