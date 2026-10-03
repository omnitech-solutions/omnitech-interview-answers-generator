# products/interview/src/backend/live-session/claim-fenced.test.ts

_Source: `products/interview/src/backend/live-session/claim-fenced.test.ts` (header-comment fallback)_

The worker's claim, lease and fence, and the fenced persistence port, on a
disposable PostgreSQL as the member role: the claim returns ids and a fence
only; an older holder is refused after a newer fence or an expired lease; a
late publish after pause, end or a newer revision is suppressed; dispatch
dedups by session, task, revision and action kind; the job id is committed
before the job exists; job creation and resume are locked to the active
session; pause and end cancel in-flight jobs and fail closed.
