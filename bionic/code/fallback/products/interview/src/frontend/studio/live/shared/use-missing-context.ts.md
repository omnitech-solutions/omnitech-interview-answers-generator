# products/interview/src/frontend/studio/live/shared/use-missing-context.ts

_Source: `products/interview/src/frontend/studio/live/shared/use-missing-context.ts` (header-comment fallback)_

Whether the strip shows for the task on show: the model's list for its
current revision, unless the person said "Looks complete" for THAT revision.
The dismissal is a per-viewer convenience kept in this browser per session,
task and revision; a new revision that reports missing context again shows
the strip again, and without storage the strip simply comes back on reload.
