---
title: "Who is speaking, from the audio a live session already captures"
slug: voice-activity-from-capture
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [coach, live-session, capture, companion, timing]
related_adrs: [ADR-0011, ADR-0012, ADR-0039]
---

# Who is speaking, from the audio a live session already captures

## Problem

The coach (ADR-0039) decides when to act from turns of speech. Speech recognition hands over a
phrase only when it is finished, so while the interviewer is mid-sentence the coach sees nothing
new and can act on half a question. A replay with a "who is speaking" signal took the coach's
benchmark from 6 model calls to 3 with no early act (BRIEF-coach-turn-taking). The Studio already
has the receiving end: `coachTranscript.setSpeaking`, a 5 s lapse, and a coach that waits while the
interviewer speaks. Live sessions had nothing that fed it.

## Where the raw audio is

| Place | What it holds | Usable for detection |
|---|---|---|
| Native shell, `SystemCompanionRun.step()` (`apps/studio-shell`), and the CLI's `runLoop` (`apps/capture-companion/macos`) | Mono Float32 frames per source, drained from a ring buffer four times a second: the microphone (AVAudioEngine tap, device rate, 4096-sample buffers) and the call's audio (ScreenCaptureKit, or a Core Audio process tap at 16 kHz in 100 ms frames). The two sources are already separate | Yes. This is the path a real call uses, and the only one where the two voices arrive apart |
| `OnDeviceTranscriber` (`CaptureAdapters/OnDeviceSpeech.swift`) | A per-frame loudness test (`voiceDecibels = -42`) that opens and closes recognition requests | Not as it stands: a fixed threshold, no noise floor, and private to a queue. It showed that loudness alone already drives the recogniser |
| Apple's recogniser (`SFSpeechRecognizer`) | Partial results while a request is open | No. macOS runs one on-device recognition task per process, so while one source holds the slot the other's audio is held back: partial results cannot say who is speaking on the source that is waiting |
| Browser window (`overlay/dictation.ts`) | A level meter: 256 samples (about 5 ms) read every 100 ms from an `AnalyserNode`, on a second microphone stream; off inside the Mac app | Possible, not built. See "Not built" |
| TypeScript companion (`apps/capture-companion/src`) | No audio: it is the wire's reference loop | It carries the message and the reporting rule, and a caller's detector |

## Design

**Detection** is energy with a hangover over an adaptive noise floor, one detector per source,
never shared. No model and no new dependency: the cases that matter (a voice on a digital call
line, a voice close to a microphone) have 20 dB or more between voice and background, and where
energy fails it fails to "not speaking", which is what the coach had before.

- Audio is measured in 20 ms hops (RMS, dBFS), whatever the frame length or sample rate.
- The noise floor is the **quietest hop of the last 3 s**. Speech dips to the room's level between
  words; a fan, a hum or music never does, so within about 3.5 s a steady noise becomes the floor
  and stops reading as a voice.
- A voice **starts** after 150 ms of audio above the start threshold (floor + 10 dB, never below
  -48 dBFS; the floor is capped at -34 dBFS). A quiet hop takes back what a loud one added, so
  separate clicks never add up.
- A voice **stops** after 500 ms unbroken below the stop threshold (4 dB under the start
  threshold). A breath inside a sentence is not a stop; a pause longer than that is.

The numbers live in one place, `VOICE_ACTIVITY_TUNING` in
`packages/active-session-contracts/src/voice-activity.ts`, mirrored by `VoiceActivityTuning` in
`CaptureCore/VoiceActivity.swift`. A Swift test parses the TypeScript file and fails on drift, and
both detectors must reproduce every vector in
`packages/active-session-contracts/corpus/vectors/voice-activity.json` exactly.

**Transport** is a new content-free message on the existing ingest route, under the session
credential like every other companion message (ADR-0011):

```json
{ "version": 1, "kind": "voice.activity", "sourceId": "companion-…",
  "sentAt": "…", "source": "application-audio", "speaking": true }
```

- It is not an observation: no event id, no sequence, never queued in the outbox, never resent.
  Studio stores nothing for it, logs nothing of it, and does not move the contact stamp, so
  heartbeat spacing is untouched.
- The companion sends a change at once, `speaking: true` again every 1 s while the voice goes on
  (Studio lets an unrepeated "speaking" lapse after 5 s), and `speaking: false` again every 15 s
  while nobody speaks, so a Studio that restarted or cleared its transcript learns the signal
  exists. A report that does not get through is said again after 1 s if still true.
- Studio takes it only while the session is active, only for an audio source the session
  registered at start, only when the switch is on, and only for a `permitted-remote` session.
  Then it calls `coachTranscript.setSpeaking(speakerOfSource(source), speaking)`: the call's
  audio is the interviewer, the microphone the candidate. A device-only session tells the coach
  nothing.
- Bound: 240 reports a session a minute (`maxVoiceActivityPerMinute`), counted in memory; over it
  the answer is `rate_limited`.

**The switch** is `ACTIVE_SESSION_VOICE_ACTIVITY=on` in the Studio's environment. It is **off by
default**. Off, or for a device-only session, Studio answers the companion's first report with the
new refusal `voice_activity_off`; the companion then sends no more for that run. A Studio that
does not know the message answers `invalid_observation`, which the companion reads the same way.
Detection itself keeps running in the Mac app either way, for the event log (below): it costs a
few hundred additions per second and nothing leaves the process.

## What is proven

| Claim | Where |
|---|---|
| Silence and steady noise are never a voice; a noise that steps up is let go within the floor's window; a voice starts within 150–300 ms and stops within 400–560 ms of its end; a 300 ms dip is not a stop and a 1.2 s pause is; 20 s of talk stays on; a voice over noise, a quiet voice, clicks, frame lengths of 319/1600/4096 samples and 48 kHz | `voice-activity.test.ts` (contracts) and `VoiceActivityTests.swift`, the same scenarios |
| The Swift and TypeScript detectors behave identically | 11 shared vectors, reproduced exactly by both |
| The wire message, both acknowledgements and four invalid forms | the corpus, read by the TypeScript and Swift conformance tests |
| Credential required (no credential, the API token, an unknown credential and another tenant's are one refusal); a report cannot name a session; device-only and switch-off reach nobody; an unregistered source, a paused and an ended session are refused; nothing stored, contact stamp untouched; the bound | `live-session/voice-activity.test.ts`, on PostgreSQL through the real route |
| End to end: synthetic PCM through the detector and the reporting rule, to the real ingest route, makes the coach's feed say `["interviewer"]` within 0.5 s, holds it for 7 s (longer than the lapse, so the keep-alives carry it), clears it within 1 s of the voice ending; a source that goes quiet mid-voice lapses at 5 s and not before; the microphone reads as the candidate | the same file, "a voice on a session's audio, end to end" |
| The companion session reports under its credential, keeps a voice alive about once a second, stops for the run on a refusal, retries after a failure, says "stopped" for a lost source, never queues a report | `VoiceActivityTests.swift` (session), `companion.test.ts` |

Run outside the tests, not kept as a fixture: two questions synthesised with the system voice
(`say`), at three gains and four noise levels. The detector held one unbroken "speaking" across
each 9 s question, through the short gaps between sentences, down to a voice about 12 dB above the
noise. With the voice 7 dB above the noise it heard half of it; with the voice at the noise's own
level it heard nothing.

## What is not proven

Nobody has heard a real call through this.

- **A real call's audio.** A meeting application's noise suppression, automatic gain and comfort
  noise are not in any test. A call line that pumps its background up between words would raise
  the floor and could cut a voice short.
- **The microphone in a real room.** With speakers instead of headphones the microphone hears the
  interviewer too, and reports the candidate as speaking. The coach only waits on the
  interviewer's flag, so this should be harmless, but it is unobserved.
- **Other sound on the tap.** A process tap takes every application's sound except this one: a
  notification is too short to start a voice, music becomes the floor after about 3.5 s, a video
  playing reads as the interviewer.
- **The step loop in the Mac app.** `SystemCompanionRun` is wired (two lines) but has no test of
  its own: it needs real audio hardware. Frames reach it through unordered main-actor tasks, which
  the detector tolerates on paper.
- **Whether the coach does better with it live.** The 6-to-3 result is from a replay with perfect
  activity; this signal is later (up to 150 ms + a 250 ms pass + a request) and less clean.

That is why it ships off.

## How to check it on a real call, then turn it on

1. Rebuild and reinstall the Mac app (`swift build -c release && scripts/bundle-app.sh` in
   `apps/studio-shell`). No new permission is asked for: it reads the audio already captured.
2. Leave the switch off. Join a call (or play a recorded interview through the speakers with the
   call's audio source selected) and tail `~/Library/Logs/Interview Studio/events.jsonl`.
   Every 15 s the `audio.fed` line now carries `appVoiceMs`, `micVoiceMs`, `appVoiceStarts` and
   `micVoiceStarts` for that window.
3. It is right when: while only the other side talks, `appVoiceMs` is most of the window and
   `micVoiceMs` near zero; while only you talk, the reverse; while nobody talks for a full window,
   both are zero; and `appVoiceStarts` is a handful a window, not dozens (dozens means it is
   chopping one voice into pieces).
4. Then set `ACTIVE_SESSION_VOICE_ACTIVITY=on`, restart Studio, and start a new session (a run
   that was told "off" stays quiet until the next one). `voiceSent` in `audio.fed` turns `true`,
   and `GET /api/v1/coach-transcript` shows `speaking`.

## How to tune it

Change the number in `voice-activity.ts`, the same number in `VoiceActivity.swift`, and regenerate
the vectors if a vector's answer changes. The symptoms:

| Symptom | Number |
|---|---|
| One voice is chopped into many (`appVoiceStarts` high) | raise `hangoverMs` (500) or `hysteresisDb` (4) |
| "Speaking" hangs on after the voice ends | lower `hangoverMs` |
| A quiet voice is missed | lower `minThresholdDb` (-48) or `marginDb` (10) |
| Room noise reads as a voice | raise `marginDb`; a noise that comes and goes needs a longer `floorWindowMs` (3000) |
| A voice in a loud room is missed | raise `maxFloorDb` (-34) with care: above about -30 a normal voice no longer clears it |
| Short sounds start a voice | raise `startMs` (150) |

If energy proves not good enough on real calls, the next step is a small permissively licensed
detector behind the same `push(frame) -> speaking` shape; nothing else would change.

## Not built

- **The browser microphone.** It is cheap to detect (the level meter exists) but not safe to send
  as things stand. That microphone hears the room, so it would report `unknown`, and the coach
  reads any speaker that is not the candidate as the interviewer
  (`coach.ts`: `read.speaking.some((who) => who !== "candidate")`). The coach would then wait for
  as long as the candidate themselves kept talking. It needs the coach to treat `unknown`
  differently first. The Mac app does not use the browser meter at all.
- **A toggle in the live window.** The switch is the Studio's environment variable only.
- **A live-session guard on `setSpeaking`.** Unlike `setScreen`, it does not check that the
  transcript held is a live one, so activity from a live session is recorded while a replay is
  attached. It lapses in 5 s and the replay's own timings overwrite it.
