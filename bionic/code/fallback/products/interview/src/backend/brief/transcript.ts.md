# products/interview/src/backend/brief/transcript.ts

_Source: `products/interview/src/backend/brief/transcript.ts` (header-comment fallback)_

A stage's transcript as speaker turns.

[DOMAIN] `readTranscript` (the coach's replay reader) gives each fragment at
the moment it was said, because a replay needs that. A reader of a stored
transcript wants what one person said before the other spoke: consecutive
fragments of one speaker are one TURN, from the first fragment's start to
the last one's end. The formats are exactly the ones `readTranscript`
parses: a recorder's timed blocks (also WebVTT and SRT), plain labelled
lines, and plain text.
