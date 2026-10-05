# products/interview/src/frontend/studio/live/shared/task-card-model.ts

_Source: `products/interview/src/frontend/studio/live/shared/task-card-model.ts` (header-comment fallback)_

One task, as both the native panel and the web page describe it: identity
(T and S numbers), what kind of task it is, the three stages and what is
established about the code. Pure; every fact comes from the session's own
runs and the server's code states, so the two surfaces cannot drift. Layout
stays with each surface.

Generated, tests passed and fully verified are three separate facts. "Fully
verified" is established only when the server says fullyVerified (see
code-states.ts); generated tests passing never stands in for it.
