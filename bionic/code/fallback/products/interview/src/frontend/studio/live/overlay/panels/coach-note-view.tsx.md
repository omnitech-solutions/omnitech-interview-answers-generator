# products/interview/src/frontend/studio/live/overlay/panels/coach-note-view.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/coach-note-view.tsx` (header-comment fallback)_

One coaching note, drawn. This file owns how a note looks; the note itself
only says what each piece is (coach-notes.ts in the contracts). The same
component draws the full note and the compact one, so the two never drift.

[DOMAIN] The colour vocabulary, used here and nowhere else:
green  say or act now: the response, the question to ask
blue   evidence: the employer, the technology, the figure that anchors it
amber  caution: a risk, a correction, a claim that is not verified
grey   supporting context: read later, never said
White is the sentence itself. A section's label takes its kind's colour and
the words inside stay white, so a note is never a wall of highlights.
