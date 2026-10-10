# products/interview/src/backend/studio-api/coach-notes.routes.ts

_Source: `products/interview/src/backend/studio-api/coach-notes.routes.ts` (header-comment fallback)_

Coach notes for the live window: read by the page, written by a coach.
A reader that names the revision it already shows is answered with no
content while nothing has changed, so it can ask often (a note grows on
screen as its coach writes it) at almost no cost.
`?space=replay` reads and writes the notes of a replay, which are kept
apart from the person's own.
