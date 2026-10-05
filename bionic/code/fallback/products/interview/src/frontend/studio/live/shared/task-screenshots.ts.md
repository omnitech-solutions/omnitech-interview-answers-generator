# products/interview/src/frontend/studio/live/shared/task-screenshots.ts

_Source: `products/interview/src/frontend/studio/live/shared/task-screenshots.ts` (header-comment fallback)_

A task's screenshots for the answer page: what the S-F read route says the
task's revisions rest on, as items a strip can draw, plus the small pure rules
around it (the count label, why a revision exists, whether images may be
added). The hook never fetches image bytes: `imageUrl` is the owner's own
screenshot route, for an <img> source.
