---
title: "The live coach, from a heard sentence to a note on screen"
slug: live-coach
type: walkthroughs
tags: [coach, engine, walkthrough, transcript, grounding]
sources: []
last_reviewed: 2026-10-09
---

# The live coach, from a heard sentence to a note on screen

Description of: as of 2026-10-09, uncommitted work on master (HEAD `0748ea7`). The examples were produced by running copies of `turns.ts`, `prompt.ts`, `reply.ts`, `coach.ts` and `coach-replay.ts` against a fake clock and a fake model, so decisions, prompts, note JSON and revisions are what the code does; the model's replies are written by hand. The person is the synthetic "Jordan Vale". Decisions: [[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]], [[adrs/ADR-0039-a-live-coach-reads-the-conversation-and-writes-the]], [[adrs/ADR-0040-the-ai-engine-is-imported-at-its-one-entry-point]].

## At a glance

A live session hears speech and Studio holds it in memory. The agent worker reads it, decides when to act, asks the engine for a note and posts the note back. The window polls the notes.

```
 live session (/input, ingest)      Studio process (memory)         agent worker
 onHeard ──remote only──► coachTranscript ◄─ GET /api/v1/coach-transcript ─ coach.tick()
 /capture (screen text) ─►  (epoch, lines)                                   │ turns.decide()
                                                                             ▼
 window ◄─ GET /api/v1/coach-notes?revision=N ◄─ coachNotes (file) ◄─ POST ─ engine.stream()
 (polls every 500 ms)                       coach-plan (file) ──► GET coach-plan ─┘   (Claude Code / Codex)
```

Studio only stores and serves. The decision about when is `products/interview/src/backend/coach/turns.ts`. The model call is `engine.stream` in `coach.ts`, built in `apps/agent-worker/src/coach-loop.ts` from `createAiEngine` with `createAgentModelPort` (toolless) over an agent runtime. It is off unless `INTERVIEW_COACH` is `claude` or `codex` and `INTERVIEW_API_TOKEN` is set.

## Scenario

Jordan Vale interviews for Principal Engineer at Larkspur Analytics (invented). The interviewer greets, then asks "How do you decide when a feature should be its own service?" in fragments, and adds a sentence two seconds later. The file below is the whole call; times are the file's clock.

```text
00:00:02 --> 00:00:05
Speaker 1: Hi Jordan, thanks for making the time.

00:00:05 --> 00:00:07
Speaker 2: Thanks, you too.

00:00:25 --> 00:00:28
Speaker 1: So, tell me,

00:00:29 --> 00:00:31
Speaker 1: um, how do you decide when a feature

00:00:32 --> 00:00:34
Speaker 1: should be its own service?

00:00:35 --> 00:00:36
Speaker 1: And I mean in practice, not in theory.

00:00:40 --> 00:00:47
Speaker 2: I keep a feature in the monolith until it has its own data owner or a different scaling profile, and then I split it out.

00:00:50 --> 00:00:57
Speaker 2: At Harbourline we ran the berth scheduler inside the main app for two years and only moved it when the pilots needed it to stay up while the rest was deployed, so we migrated it to a Go service with no downtime.

00:01:01 --> 00:01:08
Speaker 2: The team was small, so I was wary of paying for extra deployments, extra dashboards and extra on call before there was a real reason, and I would argue for that trade every time.
```

## Step 1: speech becomes transcript lines

Two paths feed `coachTranscript` (`coach-transcript.ts`, held in memory, never written):

- A stored `transcript.final` observation: `ingest.ts` builds a `HeardLine` and calls `onHeard`. In `interview-backend.ts`, `speakerOfSource` maps `application-audio` to `interviewer`, `microphone` to `candidate`, anything else to `unknown`.
- The window's own microphone tap, `POST …/sessions/:id/input` in `routes.ts`, also calls `onHeard`. It names no source, so the speaker is `unknown`.

Device-only never reaches the coach: `onHeard` returns before `coachTranscript.add` when `heard.remote` is false, and the screen tap does the same. Both taps also feed the owner's recording (see "What is kept").

Posting by hand (`node scripts/coach-transcript.mjs`) sends this body to `POST /api/v1/coach-transcript` (contract `coachTranscriptInputSchema`):

```json
{ "lines": [ { "speaker": "interviewer", "text": "So, tell me, um, how do you decide when a feature should be its own service?", "at": "2026-10-09T10:00:34.000Z" } ] }
```

`GET /api/v1/coach-transcript?after=3` returns `{ "epoch": "1a2b3c4d-…", "cursor": 5, "lines": [{ "seq": 4, "speaker": "interviewer", "text": "…", "at": "…" }], "session": { "tenantId", "actorId", "sessionId" }, "screen": { "text", "at" } }`. `session` and `screen` are present only when known. A new `epoch` (clear or restart) makes the coach forget everything.

## Step 2: the turn decision

`coach.tick` calls `decide({ fresh, silenceMs, sinceActMs })` on the lines not yet decided. The unit is a turn, not a pause. Results from running the code on Jordan's call (timing constants `TURN_TIMING`: 800 ms after a finished question, 2500 ms after finished talk, 6000 ms after a trailing sentence):

| Moment | Silence | Decision |
|---|---|---|
| "Hi Jordan, thanks for making the time." then "Thanks, you too." | 2.6 s | `act`, reason `pause` (it reads as finished, not a question). The model answers `NONE`: silent |
| "So, tell me," | any | `wait`: "the candidate has said little yet" (a short interviewer turn falls through to the candidate branch; the text is misleading) |
| "…how do you decide when a feature" | 1.0 s | `wait`: "the interviewer has not finished the sentence" (trailing) |
| "…should be its own service?" | 0.3 s | `wait`: "the interviewer may go on" |
| same | 0.8 s | `act`, `question-finished`, `until` the last line, `about: interviewer` |
| 2 s later: "And I mean in practice, not in theory." | | call in hand: `shouldRecall` is true, the call is stopped (`recall` event) |
| after the recall | 2.5 s | `act`, `pause` (the whole turn now reads as finished, not a question), same note key |
| Jordan has said 60+ words, 20 s since the last act, 1.2 s gap | | `act`, `answer-check`, `about: candidate` |

## Step 3: the engine call

Which engine method: `engine.stream` (promise: the execution as it happens, ending in one terminal event; ADR-0037). The call after the recall:

```ts
engine.stream(
  { profileId: "interview-live-coach",
    messages: [
      { role: "system", parts: [{ type: "text", text: COACH_SYSTEM /* prompt version live-coach-8 */ }] },
      { role: "user",   parts: [{ type: "text", text: coachPrompt({...}) }] } ] },
  { scope: { tenantId, actorId, productId: "omnitech.interview" },
    permissions: ["interview.read"],
    policy: "permitted-remote",
    idempotencyKey: "coach:<epoch>:6:0",          // epoch : last line seq : failures
    for: { kind: "coach", id: "<epoch>" },
    traceId: "8d4e8333cf2e8ef1eaa3c99518d04230",  // sha256("coach:<epoch>:6").slice(0,32)
    signal })
```

`tenantId`/`actorId` are the live session's owner when the transcript carries a `session`, otherwise `local`/`coach`. The system message states the rules (reply `NONE` or labelled lines `KIND`, `SAME`, `ASK`, `HEARD`, `SAY`, `ANCHOR`, `QUESTION`, `CAUTION`, optional `LOG`). The user message holds these sections, in order, omitted when empty: `THE PLAN FOR THIS CALL:`, `WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):`, `THE CANDIDATE'S RECORD (cite a fact by its [pointer]):`, `EMPLOYER MATERIAL (not the candidate's experience):`, `NOTES YOU HAVE ALREADY GIVEN (oldest first):`, `THE CONVERSATION SO FAR:`, `ON THE SHARED SCREEN …`, `NEW LINES (decide on these):`, a `WHY NOW:` sentence per reason, and for a design or coding round a `MODE:` block. Real output for this call:

```text
THE CANDIDATE'S RECORD (cite a fact by its [pointer]):
[/candidate] Name: Jordan Vale
[/candidate] Headline: Platform engineer
[/candidate] Location: Lisbon
[/roles/0/proof_points/2] Led the migration of the berth scheduler from a Rails monolith to a Go service with no downtime
[/roles/1/proof_points/0] Built a NestJS reporting service for dock invoices

EMPLOYER MATERIAL (not the candidate's experience):
[/context/employerBrief] Company: Larkspur Analytics
[/context/employerBrief] Role: Principal Engineer
[brief:questionsToAsk:f2391cdf55ed] How does the group decide what to build next?

NOTES YOU HAVE ALREADY GIVEN (oldest first):
(none)

THE CONVERSATION SO FAR:
INTERVIEWER: Hi Jordan, thanks for making the time.
CANDIDATE: Thanks, you too.

NEW LINES (decide on these):
INTERVIEWER: So, tell me,
INTERVIEWER: um, how do you decide when a feature
INTERVIEWER: should be its own service?
INTERVIEWER: And I mean in practice, not in theory.

WHY NOW: the interviewer has stopped talking. If they asked or invited something, give the answer to say; …
```

Where the record comes from is the context pack: [[research/walkthroughs/context-pack]]. The conversation window is the last 12,000 characters.

## Step 4: the model's reply, and the note

The reply streams as text parts. `parseCoachReply(text, final, known, mode)` turns each complete line into part of a note; the unfinished last line is left out until it ends. A claim in `**bold**` becomes an `evidence` segment; it is `verified` only if the code finds it in a fact the coach was given (a cited `[pointer]` must be one of them and any figure must match), otherwise `inferred`. Reply (three chunks, 3.0 s, 3.8 s and 4.4 s after the call began):

```text
KIND: technical
SAME: no
ASK: A feature as its own service
HEARD: In practice, how do you decide when a feature should be its own service?
SAY: I keep it in the **monolith**[/roles/0/proof_points/2] until a feature has its own data owner or scaling profile.
SAY: That is how I judged the **berth scheduler migration**[/roles/0/proof_points/2] at **Harbourline**: it needed to stay up on its own.
ANCHOR: default to the **monolith**
ANCHOR: split on data owner or scaling
QUESTION: How does your team decide what to build next?
LOG: asked how services are split, in practice not in theory
```

Studio receives `POST /api/v1/coach-notes`. Revision 1 (at 3.0 s after the call), shortened:

```json
{ "title": "A feature as its own service", "kind": "technical", "tone": "say",
  "ask": "A feature as its own service",
  "heard": "In practice, how do you decide when a feature should be its own service?",
  "sections": [ { "kind": "say", "lines": [ { "segments": [
    { "text": "I keep it in the ", "role": "spoken" },
    { "text": "monolith", "role": "evidence", "grounding": "verified", "source": "/roles/0/proof_points/2" },
    { "text": " until a feature has its own data owner or scaling profile.", "role": "spoken" } ] } ] } ],
  "askId": "coach-1a2b3c4d-3-ask", "key": "coach-1a2b3c4d-3",
  "at": "2026-10-09T10:00:36.000Z", "revision": 1 }
```

Revision 2 adds the second `say` line and the `anchors` section. Revision 3 (final) adds `{ "kind": "ask", … }`. In revision 2, "berth scheduler migration" is `verified` with the same source, and **Harbourline** is `inferred`: the fact text does not contain the employer name (it is in the record's fields, not its text). The `done` part posts nothing new if the shape is unchanged; the event stream marks revision 3 `final: true`.

Studio side (`coach-notes.ts`): the same `key` with a higher `revision` takes the earlier note's place; an equal or lower one is refused with 409 `stale_coach_note`, which `coachApi` ignores. `at` becomes `createdAt` for a new note.

## Step 5: what the window draws

`useCoachNotes` (`panels/coach-notes.tsx`) polls `GET /api/v1/coach-notes?revision=<last>` every 500 ms; Studio answers 204 with no body while the revision is unchanged, else `{ "revision": 1760004000123, "notes": [...] }`. The revision starts at the clock, so a restart shows as a change. `coach-layout.tsx` lists questions (grouped by `askId`, newest first, "Questions · N") and draws the notes pane for the picked one, with a "Preparing response…" line while a question is waiting. `coach-note-view.tsx` draws each section by kind (`say` = "Say this", `anchors` = "Anchors", `ask` = "Ask", `caution` = "Careful") and passes each segment's `grounding` through to the library's `CueCard`; how an inferred claim is marked on screen is not determined here.

## Scenario 2: an answer-check nudge

While Jordan answers, the coach looks at most twice per question and nudges at most once. At 00:00:58 (reason `answer-check`) the prompt ends with a `WHY NOW:` text telling the model that `NONE` is almost always right. The model replies:

```text
KIND: follow-up
SAME: yes
ASK: A feature as its own service
SAY: Close on the **cost**: every new service is one more deploy and one more on-call.
SAY: A second line the nudge will cut.
```

`coach.ts` keeps only the first line of the first section, forces `kind: "follow-up"` and files it under the previous `askId`. Posted note (key `coach-1a2b3c4d-7`, revision 1): one `say` line; **cost** is `inferred` because no fact states it. A repeat of an earlier `CAUTION` is dropped by `withoutRepeats` (60% shared long words).

## Scenario 3: system design

The plan file starts with `mode: system-design`; `modeOf` reads it, so the round is a design. Then there is one note for the whole call, key `coach-<epoch8>-design`, `kind: "technical"`, revised on each call. The reply carries `STAGE:` (`requirements`, `high-level`, `detail`, `issues`) and `DRAW: Box -> Other box: what flows`. For "Let's design a berth booking system… Walk me through how you would design it." the stage-1 reply was `QUESTION` lines (up to five allowed) plus one `SAY`. After the interviewer says "Please draw the high-level design.", the reply is:

```text
STAGE: high-level
DRAW: Pilot app -> Booking API: book a berth
DRAW: Booking API -> Berth store: reserve slot
SAY: One booking API owns the berth calendar; everything else reacts to its events.
DRAW: Booking API -> Event bus: booking confirmed
DRAW: Event bus -> Notifier: send confirmation
CAUTION: Overlap safety lives in the **berth store** constraint, not in the API code.
```

The posted note (revision 3, key `coach-1a2b3c4d-design`) carries `sections` (`say`, `caution`) and a Mermaid `diagram` built by `designDiagram` from all arrows drawn so far:

```text
flowchart LR
  n_pilot_app["Pilot app"] -->|book a berth| n_booking_api["Booking API"]
  n_booking_api["Booking API"] -->|reserve slot| n_berth_store["Berth store"]
  n_booking_api["Booking API"] -->|booking confirmed| n_event_bus["Event bus"]
  n_event_bus["Event bus"] -->|send confirmation| n_notifier["Notifier"]
```

Observed: each revision replaces the note's sections, so the stage-1 questions are gone from the note once stage 2 posts; only the diagram accumulates. The next call's prompt says `THE DESIGN SO FAR (stage: requirements):` and lists arrows as `A -> B: label`.

## What is kept

| What | Where | Notes |
|---|---|---|
| The engine's run and steps | Tables `ai.runs` and `ai.run_steps` (the engine's default schema name `ai`; the name Studio configures is not determined) in the database named by `AI_ENGINE_DATABASE_URL` | One run per `traceId` (`runs_trace_key` on tenant and trace). Columns used here: `runs.for_kind='coach'`, `for_id=<epoch>`, `status`, `steps`, `started_at`, `finished_at`; `run_steps.kind`, `attempt`, `profile_id`, `provider`, `model`, `outcome`, `failure`, `duration_ms`, `time_to_first_part_ms`, `input_tokens`, `output_tokens`, `idempotency_key`, `content`. `content` (prompt, answer) is filled only with `AI_ENGINE_CAPTURE=full`; otherwise ids, timing and usage only. Without the URL, runs are logged and exported as spans, not kept. The step `kind` and run `operation` values for an agent-runtime stream are not determined. |
| The notes | `coach-notes.json` in the data directory (`INTERVIEW_DATA_DIR`, default `.data` under the Studio's working directory) | Max 200; survives restart; `DELETE /api/v1/coach-notes` clears them and the transcript. A replay's notes (`?space=replay`) live in memory only. |
| The plan | `coach-plan.md` in the same directory, max 8,000 characters | Read by the coach at most once a minute. |
| The transcript | Studio memory only | Max 4,000 lines; emptied on restart or clear. |
| A recording | A file in `transcripts/` under the data directory, `<timestamp>-<session8>.txt` | Only after the owner presses "Record transcript" (`POST …/sessions/:id/recording {"on":true}`); off at every window open, session end and restart; includes device-only sessions; mode 0600. |

Read the runs:

```sql
select started_at, status, steps, for_id from ai.runs where for_kind = 'coach' order by started_at desc limit 10;
select outcome, duration_ms, time_to_first_part_ms, input_tokens, output_tokens
  from ai.run_steps s join ai.runs r on r.id = s.run_id where r.trace_id = '<traceId>';
```

Row-level tenant setting on reads: not determined.

## Try it

```bash
# save the call above as talk.txt
pnpm -s coach:replay talk.txt --speakers
# expect: talk.txt: 00:00:02 to 00:01:08, then Speaker 2 (104 words, 4 pieces) and Speaker 1 (31 words, 5 pieces)

pnpm -s coach:replay talk.txt --interviewer "Speaker 1" --me "Speaker 2" --timing
# expect (no model; the absent model takes 4 s, --latency S changes it):
# 00:00:09  ACT    pause             +2.6s after "Hi Jordan, thanks for making the time."
# 00:00:34  ACT    question-finished +0.8s after "So, tell me, um, how do you decide … its own service?"
# 00:00:36  AGAIN  the interviewer went on: the call is made again with the whole turn
# 00:00:38  ACT    pause             +2.6s after "…not in t…"
# 00:00:58  ACT    answer-check      +1.6s after "I keep a feature in the monolith …"
# 4 actions in 1.1 minutes …: 2 pause, 1 question-finished, 1 recall, 1 answer-check.

pnpm -s coach:replay talk.txt --interviewer "Speaker 1" --me "Speaker 2" --runtime claude --speed 4 --plan plan.md
# real model: notes print at the end as "<time>  <kind>: <ask>" then one line per section; ✓ marks a verified claim
```

Other commands: `--runtime codex`, `--hide-me`, `--from`/`--to HH:MM:SS`, `--studio` (also shows the replay's notes in the running Studio, kept apart from yours).

```bash
printf 'mode: system-design\nRound with the head of platform.\n' > plan.md
node scripts/coach-plan.mjs plan.md        # set; also --show and --clear
node scripts/coach-transcript.mjs talk.txt --interviewer "Speaker 1" --candidate "Speaker 2" --speed 1
node scripts/coach-transcript.mjs --clear
node scripts/coach-note.mjs '{"title":"x","points":["y"]}'   # one note by hand; --clear
```

`coach-transcript.mjs` joins consecutive blocks of one speaker, so Studio sees fewer, longer lines than the replay does. The Studio must be running; the token is `INTERVIEW_API_TOKEN` or `.dev-local/api-token`. For a desktop agent, run Studio with `INTERVIEW_COACH=off`, then loop `pnpm -s coach:listen` (prints one JSON moment: `reason`, `about`, `turn`, `new`, `before`, `plan`, `key`; exit 0 moment, 2 nothing in 10 minutes, 1 Studio unreachable) and post with `coach-note.mjs`. Rules are in `.agents/skills/live-coach/SKILL.md`.

## Limits and decisions

- No transcript at rest ([[adrs/ADR-0039-a-live-coach-reads-the-conversation-and-writes-the]]); a verified mark comes from a check in code only.
- Every call goes through the engine's one entry point ([[adrs/ADR-0040-the-ai-engine-is-imported-at-its-one-entry-point]]); agents run only in the worker ([[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]]).
- Facts from the pack share the pointer `/candidate` for name, headline and location, so the coach's lookup by pointer keeps only the last of them (observed in `coach.ts` `known`).
- One transcript and one set of notes per Studio process, not per tenant.
