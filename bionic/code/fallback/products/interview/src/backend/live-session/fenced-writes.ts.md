# products/interview/src/backend/live-session/fenced-writes.ts

_Source: `products/interview/src/backend/live-session/fenced-writes.ts` (header-comment fallback)_

The persistence port that enforces the core's publish eligibility ATOMICALLY
with the write (rule:fenced-current-publish). Every write runs in the owner's
tenant-and-actor transaction after locking the session row, and checks, under
that lock, that the session status, the holder's fence, the holder's
unexpired lease and the task revision are all current. A stale holder writes
nothing and receives a refusal outcome; a failed status or revision check
records a suppression row carrying ids and a code only
(rule:id-only-traces). Job creation and resume are locked to the session the
same way (rule:job-creation-locked-to-session, rule:no-resume-after-end),
and the action naming a pre-generated job id is committed before the job
exists (rule:action-before-job).
