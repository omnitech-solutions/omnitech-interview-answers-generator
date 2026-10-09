# products/interview/src/backend/live-session/voice-activity.ts

_Source: `products/interview/src/backend/live-session/voice-activity.ts` (header-comment fallback)_

Voice activity from a session's audio sources (ADR-0039): whether a voice is
being heard on the microphone or on the call RIGHT NOW. A final transcript
line arrives only when its phrase is over, so the coach cannot tell from text
that the interviewer is still talking; this tells it. [SAFETY] It is a
transient signal and never content: nothing here is stored, logged or kept
beyond a per-session count of recent reports.
