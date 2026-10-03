# products/interview/src/frontend/studio/live/session-runs.ts

_Source: `products/interview/src/frontend/studio/live/session-runs.ts` (header-comment fallback)_

Activity runs: one chip per action the session decided to run, saying what
became of it. Pure: the state follows from the action's dispatch status, its
suppression reason, whether its result was written to the Workspace, and
whether the task revision and fence it ran under are still current.
