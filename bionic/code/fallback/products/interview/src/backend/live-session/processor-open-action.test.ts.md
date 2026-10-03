# products/interview/src/backend/live-session/processor-open-action.test.ts

_Source: `products/interview/src/backend/live-session/processor-open-action.test.ts` (header-comment fallback)_

The action a dispatch recorded is "open" only while that dispatch runs: once
it has settled, a LATER dispatch that throws before recording its own action
must not settle the earlier, finished one as failed.
