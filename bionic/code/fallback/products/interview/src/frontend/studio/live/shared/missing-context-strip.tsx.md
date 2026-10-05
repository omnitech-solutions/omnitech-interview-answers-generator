# products/interview/src/frontend/studio/live/shared/missing-context-strip.tsx

_Source: `products/interview/src/frontend/studio/live/shared/missing-context-strip.tsx` (header-comment fallback)_

"The AI may be missing ...": what the model said it could not see for the
task on show, and the three ways to answer it. One component and one action
table for the native window and the web page; each surface passes what an
action does (or why it cannot) and a variant that picks its styling.

Supplying context REVISES the same task: the screenshot or typed text goes to
the task on show at its current revision. "Looks complete" only hides the
strip for that revision (see use-missing-context.ts).
