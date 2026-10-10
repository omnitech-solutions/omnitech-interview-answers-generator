# products/interview/src/backend/live-session/handlers/voice-activity.handler.ts

_Source: `products/interview/src/backend/live-session/handlers/voice-activity.handler.ts` (header-comment fallback)_

Whether a voice is being heard on one of the session's audio sources right
now. [SAFETY] A transient signal, never content: nothing of the report is
written (no observation, no artifact, not even the contact stamp, so a
heartbeat's spacing is untouched) and nothing of it is logged. It is taken
only while the session is capturing, only for an audio source the session
registered at start, only when the owner's switch is on, and only for a
session whose owner allows processing off this device (the listener is the
coach, on a remote model). Everything else is a content-free refusal;
voice_activity_off tells the companion to stop sending for the rest of its
run.
