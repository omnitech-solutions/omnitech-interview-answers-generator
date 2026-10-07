# products/interview/src/frontend/studio/live/session-merge.test.ts

_Source: `products/interview/src/frontend/studio/live/session-merge.test.ts` (header-comment fallback)_

mergeActions: the newest updatedAt wins, and a tie never moves an action
back to in_flight (the only non-final status), whichever copy arrives last.
