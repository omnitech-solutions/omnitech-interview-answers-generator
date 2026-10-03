# products/interview/src/backend/live-session/session-run.test.ts

_Source: `products/interview/src/backend/live-session/session-run.test.ts` (header-comment fallback)_

The run's utterance processing, paced like the processor does it: segments
arrive over time, the settle window closes an utterance, and a closed
utterance is never reopened by a later segment (M1). No database.
