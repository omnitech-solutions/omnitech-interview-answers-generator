# products/interview/src/frontend/studio/live/shared/revisions.ts

_Source: `products/interview/src/frontend/studio/live/shared/revisions.ts` (header-comment fallback)_

A task's revisions, as both the native window and the web page describe
them: one list (newest first), which revision is on show, and the view of the
task AT that revision. A revision is a view of the same task, never another
row or entity. Which one is on show is view-only page state (the picks in
focus-presentation); the server never hears of it, and a follow-up still goes
to the task's CURRENT revision (task-target.ts). Pure.
