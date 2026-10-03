# products/interview/src/backend/live-session/processor-replay.test.ts

_Source: `products/interview/src/backend/live-session/processor-replay.test.ts` (header-comment fallback)_

The session processor over the synthetic recruiter-screen script, with the
real ingest path, the real repository and fenced writes on a disposable
PostgreSQL, and a fake gateway returning canned closed-schema output:
no task from backchannel or monologue, one logical task per question,
revisions that make the earlier answer stale, a deferred topic kept, an ASR
correction that supersedes an earlier segment, nothing published for stale
work, and dispatch deduplicated by session, task, revision and action kind.
