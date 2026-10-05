# products/interview/src/frontend/studio/live/shared/task-target.ts

_Source: `products/interview/src/frontend/studio/live/shared/task-target.ts` (header-comment fallback)_

Which task a follow-up or an added screenshot is about. Both surfaces use
this one rule: the task the person is looking at (the one they pinned, else
the newest), at that task's own current revision. Never "whatever was acted
on last": looking at an earlier task must not redirect what is asked of it.
