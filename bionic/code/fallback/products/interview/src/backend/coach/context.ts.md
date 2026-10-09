# products/interview/src/backend/coach/context.ts

_Source: `products/interview/src/backend/coach/context.ts` (header-comment fallback)_

What the coach knows about the person, for one stretch of conversation: the
facts of their approved record that bear on what was just said.

STRATEGY: nothing new is read or ranked here. The live session already has
its approved context (the pinned experience matrix, the employer brief, the
person's preferences) and one ranking of it against what was asked; the
coach reads the same context through the same ranking, in the session
owner's scope, so it can never see more than the session's own answers do.
