# products/interview/src/backend/coach/context.ts

_Source: `products/interview/src/backend/coach/context.ts` (header-comment fallback)_

What the coach knows about the person, for one stretch of conversation: the
facts of their approved record that bear on what was just said.

STRATEGY: nothing is read or ranked here. The session's approved material
(the pinned experience matrix, the employer brief, the person's
preferences) is read in the session owner's scope, prepared once into the
context pack (ADR-0038), and the pack's "coach" projection is resolved for
each stretch. The coach is given exactly what that projection selects.
