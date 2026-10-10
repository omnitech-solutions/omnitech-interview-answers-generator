---
title: "The coach in a panel: who asked, and whom the answer is for"
slug: panel-aware-coach
type: brief
status: draft
created_at: 2026-10-09
updated_at: 2026-10-09
authors: ["desoleary", "claude"]
tags: [coach, panel, transcript, replay, benchmark, capture]
related_adrs: [ADR-0012, ADR-0039]
---

# The coach in a panel: who asked, and whom the answer is for

## Problem

On 2026-10-16 the owner faces a panel of up to five interviewers. Every interviewer reached the
coach (ADR-0039) as the one speaker "interviewer". Two panelists starting at once arrived as one
muddled turn ("Can I ask about, And what about idempotency, how you work with product when— if a—
go ahead, Elena. you go, m…"), a note could not say who asked, and the answer could not be aimed at
what that person judges, although the plan for the call names each panelist and what they judge.

## Where a panelist's identity can come from

| Source | Does it know who spoke? |
|---|---|
| A replay or a fixture (`pnpm coach:replay`, `fixtures/calls/`) | Yes. The recorder's labels name each speaker. They were thrown away at `castBlocks`, which kept only interviewer, me or unknown |
| A recorder's file posted to Studio (`scripts/coach-transcript.mjs`, `parseTranscriptFile`) | Yes, the same labels |
| A live session (`onHeard` in `interview-backend.ts`) | No. The call's audio is one stream (ScreenCaptureKit with `channelCount = 1`, or a Core Audio process tap); `speakerOfSource` maps the whole of it to "interviewer" |

### Live: can anything on the machine separate voices today?

Checked on this machine (macOS 26.6, SDK 26.2; both Swift packages target macOS 14):

- The app recognises speech with `SFSpeechRecognizer`, on the device only. Its results carry text,
  timings and confidence. They carry no speaker.
- The newer on-device API in the SDK (`SpeechAnalyzer` with `SpeechTranscriber`,
  `DictationTranscriber`, `SpeechDetector`; macOS 26 only) was read from the SDK's Swift interface.
  It has no speaker attribution either: no type, option or result attribute names a speaker.
  `SpeechDetector` says whether there is speech, which the app already derives from loudness
  (BRIEF-voice-activity-from-capture).
- `SFVoiceAnalytics` gives pitch, jitter and shimmer per recognised segment. Telling five people
  apart by pitch is not reliable (voices overlap in range, and a segment is a phrase, not a
  speaker), so it was not built on.
- `SoundAnalysis` classifies kinds of sound. It does not identify or separate speakers.
- One mono stream holds no direction or channel to separate by.

So nothing cheap and reliable exists on the machine today. **No diarization was built.** A meeting
app's own captions, which do name speakers, are out of scope.

A cheap, honest proxy does exist in the words themselves: a panelist hands over by name ("I'm going
to hand over to Marcus now"), introduces themselves ("I'm Aisha, from the people team") or is
addressed by name. The model can use these when the plan gives it the roster, and code can refuse
any name that is not on the roster.

## Design

Simplest thing that works, driven by the plan and by what the source of a line knows. No new
dependency, no change to the capture wire contract.

1. **An optional name on a transcript line** (`coachTranscriptLineSchema.name`, and on the input).
   Letters, digits, spaces and the marks a name has, at most 40 characters: it is put in front of a
   line the model reads, so it can never hold a colon or a line break. It is carried only by a
   source that knows: a replay's or a recorder file's labels when more than one label is the
   interviewer, or whoever posts lines to `/api/v1/coach-transcript`. The live tap sends none.
   Nothing in the code makes a name up. With one interviewer label no name is carried, so a
   two-person replay is unchanged.
2. **Turn-taking: the panel is one side.** The candidate answers the panel, so "is the other side
   still talking" and "has the other side finished" are asked of all interviewers together. Cutting
   the side by voice would do harm: the abandoned half-sentence of the panelist who gave way would
   become a turn of its own and be acted on, and a handover would read as two turns to answer. So a
   named line joins the interviewer's turn exactly as an unnamed one does, and **when the coach
   acts is the same with and without names** (held by tests on `decide`, on the coach and on the
   whole fixture). A turn records whose voices it holds (`Turn.voices`).
3. **What the model reads.** A named line reads `MARCUS (interviewer): …`, so an overlap reads as
   two people. When the plan has a roster, or lines are named, the user message gains a block,
   `THE PANEL`, after the plan: the roster with what each judges, and three rules: aim the answer
   at what the asker judges; talk between panelists (a handover, an audio check, "are we at time",
   giving way) is nothing to coach. The rule for who asked (`FROM: Name`) is one line said with
   every turn, straight before the new lines: with names on the lines FROM is asked for; without
   them it is allowed only on an explicit cue in the words, and a guess is forbidden. The system message is unchanged, and a call with no roster and no names is
   sent exactly the prompt it was sent before. Prompt version `live-coach-9`.
4. **Who asked is checked in code.** `FROM` is kept only if it is a name the coach was given
   (`voiceAmong`): where the turn's lines are named, someone who spoke in that turn; otherwise
   someone on the plan's roster. Anything else is dropped. A turn in which exactly one named
   interviewer spoke is marked as asked by them whether or not the model wrote it. A look at the
   candidate's own answer never names anyone. The note carries `from`, and the notes pane shows it
   in the note's existing quiet line ("Technical · from Marcus · 10:44:28"): no new UI part.
5. **The roster** is one forgiving line of the plan, read by `rosterOf`:
   `panel: Priya (hiring manager), Marcus (staff engineer: reliability), Tom`. Also `panelists:`,
   `interviewers:`, `who is there:`. A plan without it, or naming one person, has no panel.
6. **Replay and benchmark.** `castBlocks` keeps the label as the name; `--no-names` drops it, to
   replay a panel as a live call is heard. A run without names is its own benchmark
   (`panel-round-unnamed`). Each question in `expected.json` says who asks it (`from`); a live run
   reports how many notes named the right person, the wrong person and nobody.

## What is proven

Decisions (no model, `pnpm coach:bench:panel:timing` and `:unnamed:timing`): unchanged from before
the change, and identical with and without names: 23 acts, 1 call made again, 13 of 13 required
questions acted on whole, 1 act on part of a question, 2 acts on what was no question.

Live, Claude Code, names on the lines (`pnpm coach:bench:panel:claude`, one run):

| | Before (2026-10-09 23:22, `live-coach-8`) | After (names on the lines) |
|---|---|---|
| Questions acted on whole | 15 of 15 | 15 of 15 |
| Acts on part of a question (notes shown for them) | 1 (0) | 1 (0) |
| Acts on what was no question (notes shown) | 2 (0) | 2 (0) |
| Acts, calls made again, notes, silent, failed | 22, 0, 18, 4, 0 | 22, 0, 18, 4, 0 |
| Question end to first line | 2.2 to 5.1 s, median 3.0 | 3.4 to 5.5 s, median 3.8 |
| Acting to first line | median 2.0 s | median 3.0 s |
| Notes that say who asked | not possible | 15 of 15 right, 0 wrong, 0 nobody |

The first line was about 0.9 s later. The two-person call, whose prompt this change does not
touch, was run as a control straight afterwards and was also later than its last run (acting to
first line 3.3 and 2.9 s against 2.8 and 2.0 s), so most or all of the difference is the model's
speed at the time. One run cannot separate the two; it is listed below as not proven.

How many of the 15 names the model wrote and how many the code filled in (a turn with one named
voice) was not counted.

Live, Claude Code, nobody named (`pnpm coach:bench:panel:unnamed:claude`, one run): the condition
of a real call, except for what is listed below.

| | Nobody named |
|---|---|
| Questions acted on whole | 15 of 15 |
| Acts on part of a question (notes shown) | 1 (0) |
| Acts on what was no question (notes shown) | 2 (0) |
| Acts, calls made again, notes, silent, failed | 22, 1, 18, 3, 0 |
| Question end to first line | 3.4 to 5.9 s, median 4.0 |
| Notes that say who asked | 0 of 15 right, **0 wrong**, 15 name nobody |

That run named nobody, not even after "I'm Aisha, from the people team". The rule for FROM was
then said once, in what a kept session is told when it opens. It was moved to every turn, and a
2.7-minute stretch of the same call (10:46:36 to 10:49:20, seven questions, nobody named) was run
again: Aisha was named on both of her questions after introducing herself, the other five notes
named nobody, including the close, where Priya takes over without a cue; 0 wrong. An earlier
50-second stretch named Marcus after "I'm going to hand over to Marcus now".

**The two ten-minute runs were made before that last change and were not repeated.** Their timing
and their 15 of 15 are for the prompt with the rule said once; the final prompt differs by that
one line's place.

Tests: the existing suites were extended, none replaced. Two-person behaviour is pinned: every
earlier test passes untouched, and new tests hold that an unnamed call's prompt has no panel block,
no names and no FROM, and that a FROM written for it is dropped.

## What is not proven

- **Live, nothing about who spoke is known.** The unnamed run is a replay of a scripted panel. It
  shows what the model does with text cues in a clean transcript. A real call adds recognition
  errors in names ("Marcus" heard as "Marcos" or missed), cues that never come (a panelist who just
  starts talking), and one recogniser on one mixed stream, where two people talking at once give
  garbled text, not two interleaved lines as in the fixture.
- **Two people at once, live.** The fixture's overlap is two clean interleaved streams. On one
  mixed stream the recogniser will produce something worse. The named run shows the coach reads an
  overlap correctly when voices are told apart; nothing shows it for a real mixed stream.
- **That the answer is aimed at what the asker judges.** The prompt asks for it and the notes can
  be read, but the benchmark does not score it.
- **Whether the panel text costs time.** The first line came about 0.9 s later than in the last
  run before this change; a control without the panel text slowed by a similar amount. Not
  separated.
- **The final prompt over a whole call.** See above: ten minutes were run with the rule said once,
  2.7 minutes with it said every turn.
- **One run per condition.** A model's replies vary run to run; one run is an observation, not a
  rate.
- **A wrong name live.** Code refuses a name that is not on the roster. It cannot refuse the wrong
  roster name: live there is no line to check it against. The prompt forbids a guess; the unnamed
  run counts wrong names on this one call.
- Codex was not run.

## The cheapest credible route to real live speaker separation

1. **Diarize the call's audio on the device, in the capture companion.** The companion already
   holds the call's audio as mono frames (the process tap gives 16 kHz). A diarizer gives each
   stretch of speech a voice number, not a name. Candidates to evaluate, none tried here: a Core ML
   port of pyannote segmentation with speaker embeddings (for example the FluidAudio Swift
   package), or sherpa-onnx. Cost: a new Swift dependency and model files of tens of megabytes,
   which is the heavy dependency this work was told not to add without a decision.
2. **Carry the voice on the wire.** `transcript.final` in `packages/active-session-contracts`
   would gain an optional voice tag. That contract is versioned with a corpus, so this is a
   deliberate change with its own corpus entries.
3. **Turn a voice number into a name.** The coach's line already has the field. The binding from
   "voice 2" to "Marcus" comes from the same cues the model uses today (a handover, an
   introduction), made once per voice and then held for the call, so one cue names every later line
   of that voice. Until a voice is bound its lines stay unnamed.
4. **Measure before trusting it**: record a real panel call (the owner's "Record transcript"), mark
   who spoke, and score the diarizer on it. The replay and the `from` score built here are the
   harness for that.

Without a model: the meeting app's own captions name speakers and are the most reliable source,
but were ruled out of scope. Reading the active-speaker highlight from the screen capture is
possible and fragile.

For 2026-10-16 none of this will exist. What the owner has: a `panel:` line in the plan, the rules
for a panel, and a name on a note only when the words made it certain.
