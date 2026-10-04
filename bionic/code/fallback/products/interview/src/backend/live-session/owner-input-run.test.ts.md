# products/interview/src/backend/live-session/owner-input-run.test.ts

_Source: `products/interview/src/backend/live-session/owner-input-run.test.ts` (header-comment fallback)_

Owner input in a run's task state (ADR-0016), without a database: an analyze
or typed input becomes a task (or a revision) whose provenance names the
input and the exact snapshots, never a transcript segment; replay after a
restart does not apply an input twice; attachments name provenance ids only.
