# products/interview/src/backend/briefing/edits.ts

_Source: `products/interview/src/backend/briefing/edits.ts` (header-comment fallback)_

[SAFETY] A briefing edited by the person (or by the assistant on their
behalf) keeps evidence only where nothing it rests on changed: an edited
answer, or any answer after the interview context changed, loses its
evidence links and is marked for review. Evidence is only ever set by the
server, never accepted from an edit.
