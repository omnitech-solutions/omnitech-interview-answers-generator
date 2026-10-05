# products/interview/src/backend/live-session/processor-stop-work.test.ts

_Source: `products/interview/src/backend/live-session/processor-stop-work.test.ts` (header-comment fallback)_

The owner's "stop work" (control command `stop-work`) through the real
repository, processor and fenced writes on a disposable PostgreSQL: it
abandons the dispatch in flight and every revision pending at that moment,
keeps the session ACTIVE, never lets the abandoned revisions dispatch again
(not on later ticks, not in a rebuilt run), and leaves later questions and
new task revisions to dispatch normally.
