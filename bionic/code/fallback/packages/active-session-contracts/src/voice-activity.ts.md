# packages/active-session-contracts/src/voice-activity.ts

_Source: `packages/active-session-contracts/src/voice-activity.ts` (header-comment fallback)_

[DOMAIN] What "speaking" means on the wire: the one definition every sender
of a voice.activity message shares, so the signal reads the same whichever
source produced it. It lives with the contract for that reason, and because
its two senders (the capture companion, which may import only this package,
and the Studio's own window) have nothing else in common. The macOS
companion mirrors it in Swift (CaptureCore/VoiceActivity.swift); a test
there parses the numbers below and fails if one drifts.

[STRATEGY] Energy with a hangover over an adaptive noise floor. Audio is
measured in short hops; the floor is the QUIETEST hop of the last few
seconds (speech always dips to the room's level between words, a steady
noise never does, so a fan or music becomes the floor and stops reading as
a voice); a voice starts after enough loud hops and stops only after a
stretch of quiet ones, so a breath inside a sentence is not a stop.
[SAFETY] Pure arithmetic over numbers handed in: nothing is kept but a few
seconds of loudness values (never samples), and nothing is written or sent.
