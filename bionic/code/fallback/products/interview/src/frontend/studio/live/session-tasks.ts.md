# products/interview/src/frontend/studio/live/session-tasks.ts

_Source: `products/interview/src/frontend/studio/live/session-tasks.ts` (header-comment fallback)_

Tasks: one per task id, with every revision, built from the session's
actions. The stream carries no task table, so a task is what its actions say
it is: its current revision is the highest revision any action ran for, its
kind comes from the answer's category (or from a coding action), and its
constraints come from the coding briefs of its revisions.
