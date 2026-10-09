# products/interview/src/backend/live-session/transcript-recording.ts

_Source: `products/interview/src/backend/live-session/transcript-recording.ts` (header-comment fallback)_

The owner's own recording of what a live session hears, as a transcript
file on this machine.

[DOMAIN] A session's observations are deleted when it ends (ADR-0011). A
recording is a second, explicit keep: it exists only because the owner
pressed record, holds nothing from before that moment, and is a plain file
they can open, replay through the coach, or delete.
[SAFETY] It is off until asked for, every time: the state lives in this
process only, so a restart, like the end of a session, leaves it off. The
words go to the file and nowhere else (never the database, never the log).
