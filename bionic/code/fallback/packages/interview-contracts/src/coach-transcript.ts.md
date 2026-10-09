# packages/interview-contracts/src/coach-transcript.ts

_Source: `packages/interview-contracts/src/coach-transcript.ts` (header-comment fallback)_

[DOMAIN] The coach's transcript: what was said in the conversation, line by
line, as the coach reads it. It is the coach's INPUT and nothing else: the
lines a live session heard (where that session may be processed off the
device), or a transcript a person attached. It is held in memory by the
running Studio, never written to the database, a file or the log, and it
goes when the coach's notes are cleared.
