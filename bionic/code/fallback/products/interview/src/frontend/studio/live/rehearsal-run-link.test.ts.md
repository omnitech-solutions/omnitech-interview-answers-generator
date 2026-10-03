# products/interview/src/frontend/studio/live/rehearsal-run-link.test.ts

_Source: `products/interview/src/frontend/studio/live/rehearsal-run-link.test.ts` (header-comment fallback)_

The store re-hydrates the ended session after a reload, so the memory of
which run ids were saved has to survive one too, or the next save re-sends a
run id the server already derived and refuses.
