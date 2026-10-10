---
title: "The live coach, from a heard sentence to a note on screen"
slug: walkthrough-live-coach
type: references
tags: [coach, engine, walkthrough, transcript, grounding]
sources: []
last_reviewed: 2026-10-10
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

`GET /api/v1/coach-transcript?after=3` returns `{ "epoch": "1a2b3c4d-…", "cursor": 5, "lines": [{ "seq": 4, "speaker": "interviewer", "text": "…", "at": "…" }], "session": { "tenantId", "actorId", "sessionId" }, "screen": { "text", "at" } }`. `session` and `screen` are present only when known. A line may also carry `name`, the interviewer who spoke, when its source knew (see "Scenario 4: a panel"); a live session's lines never do. A new `epoch` (clear or restart) makes the coach forget everything.

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
      { role: "system", parts: [{ type: "text", text: coachSystem(grounding) /* prompt version live-coach-10; "plain" is live-coach-9 word for word */ }] },
      { role: "user",   parts: [{ type: "text", text: coachPrompt({...}) }] } ] },
  { scope: { tenantId, actorId, productId: "omnitech.interview" },
    permissions: ["interview.read"],
    policy: "permitted-remote",
    idempotencyKey: "coach:<epoch>:6:0",          // epoch : last line seq : failures
    for: { kind: "coach", id: "<epoch>" },
    traceId: "8d4e8333cf2e8ef1eaa3c99518d04230",  // sha256("coach:<epoch>:6").slice(0,32)
    signal })
```

`tenantId`/`actorId` are the live session's owner when the transcript carries a `session`, otherwise `local`/`coach`. The system message states the rules (reply `NONE` or labelled lines `KIND`, `SAME`, `ASK`, `HEARD`, `SAY`, `ANCHOR`, `QUESTION`, `CAUTION`, optional `LOG`). The user message holds these sections, in order, omitted when empty: `THE PLAN FOR THIS CALL:`, `WHAT YOU HAVE NOTED SO FAR IN THIS CALL (oldest first):`, `THE CANDIDATE'S RECORD (cite a fact by its [pointer]):`, `THE CANDIDATE'S OWN NOTES (…)` (only with grounding on: see "Grounding" below), `EMPLOYER MATERIAL (not the candidate's experience):`, `NOTES YOU HAVE ALREADY GIVEN (oldest first):`, `THE CONVERSATION SO FAR:`, `ON THE SHARED SCREEN …`, `NEW LINES (decide on these):`, a `WHY NOW:` sentence per reason, and for a design or coding round a `MODE:` block. Real output for this call:

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

Where the record comes from is the context pack: [[research/references/walkthrough-context-pack]]. The conversation window is the last 12,000 characters. The output above is the coach with grounding off (`INTERVIEW_COACH_GROUNDING=off`, or `--grounding plain` in a replay); what grounding on changes is in "Grounding: what a note may claim".

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

## Grounding: what a note may claim

One switch, `INTERVIEW_COACH_GROUNDING` (a behaviour flag: Settings, "Behaviour"; on unless turned off; read by the agent worker in `coach-loop.ts`). It sets two options of `createCoach`, which a replay can set one at a time (`--grounding strict|plain`, `--cite words|pointer`). Measured in [[briefs/BRIEF-interview-brief-and-context-pack]], section 15.

| Option | Off (the coach as it was) | On |
|---|---|---|
| `grounding` (`prompt.ts`) | `plain`: the standing instructions of `live-coach-9`. The person's prep notes, and what they answered and promised in an earlier stage, are listed under `EMPLOYER MATERIAL (not the candidate's experience)` with a pointer | `strict` (`live-coach-10`): those facts (`about: "notes"`, set in `context.ts`) are listed under `THE CANDIDATE'S OWN NOTES (what they prepared to say, and said before: theirs, no pointer):` as `- text`. The standing instructions change in four rules and gain four (below). A turn that carries facts of the record ends, straight before `NEW LINES`, with one `RECORD: …` line that repeats the rule for citing |
| `cite` (`reply.ts`) | `pointer`: a cited claim verifies when its pointer is one of this turn's facts and its figures are that fact's. Its words are not looked at | `words`: also, at least half of the words that carry the claim are the cited fact's (a hyphen separates; a long word is compared by its first five letters). A pointer written after a few more words belongs to the nearest bold phrase before it that cites nothing. And the facts given EARLIER in the conversation verify too: a model kept in one session still cites them |

What `strict` says that `plain` does not: a line built on a fact says where ("At Northwind, …"), never "on one project"; a pointer stands on words its fact says, and a figure or a technology stays with the employer whose fact states it; when a fact bears on a question about what the person did, one `SAY` line is that proof; the person's own notes are theirs, to be preferred, and are not the verified record; general knowledge is worded as what they would do, never as what they did; what is not shown is never said to be absent (asked whether they have used something nothing shows, the note is a `CAUTION` to answer it themselves plus the nearest fact); pay with no preference on record is one `CAUTION` and no figure, not even the employer's range; the first `SAY` line is short; the log holds what was said, never a conclusion about the person.

In every mode a claim is verified only against the person's record and preferences. Their own notes never verify a claim (`known` in `coach.ts`), so a line taken from a prep note shows as inferred in the window.

Measured on two stretches of the invented Tidewell panel (26 questions, Claude Code, one run each; the brief's section 15 has every arm, what was dropped and what is not proven):

| | Coach as it was | Grounding on |
|---|---|---|
| Notes right (a verified claim of an accepted employer, none of another) | 8 of 26 | 18 of 26 |
| Notes whose claims are all the model's own | 8 | 3 |
| Claims resting on nothing given or said | 17 | 10 |
| Claims verified against the record | 14 | 31 |
| Acting to first line, median and slowest | 3.1 s, 4.6 s | 3.5 s, 8.1 s |

The cost is the last row: the median is the same, and on two or three questions the model's first word comes several seconds later. The live panel benchmark with grounding on, twice: 15 of 15 questions acted on whole, 15 of 15 askers right, median first line 3.2 s and 3.3 s (2.1 to 3.3 s before), its slowest question 8.0 s and 7.6 s (4.7 s before).

A replay scores what the notes say (`coach-notes-score.ts`): per question, the verified claims by employer, the claims that rest on the person's own notes or plan, on a fact of the record it did not cite, or on nothing; the employers named; and whether the note is `right`, `grounded`, of the wrong employer, or inference only. A stretch (`--from`, `--to`) is scored on the questions said in it. A replay with `--stage N` leaves the replayed stage's own transcript and outcome out of the material: a live coach has no transcript of the call it is listening to.

Whatever the model writes: a pointer in bold (`**[/roles/0/metrics/1]**`), a pointer between two bold phrases, or a bracket after a bold phrase that is no pointer (`[posting]`) is never shown as words (`lineOf` in `reply.ts`).

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

## Scenario 4: a panel

Several interviewers are one side to the turn decision: the candidate answers the panel, so "has the other side finished" is asked of all of them together, and when the coach acts is the same with and without names (`turns.ts`; a test replays the fixture both ways and compares). What a name changes is what the model reads and what a note may say.

Where a name comes from. A transcript line may carry `name` (`coachTranscriptLineSchema`: letters, digits, spaces, `.`, `'`, `-`, at most 40 characters, so it can never hold a colon or a line break). It is set only by a source that knows:

| Source | Names? |
|---|---|
| `pnpm coach:replay` with more than one `--interviewer` label (or a fixture with several) | Yes: each interviewer block keeps its label (`castBlocks`). `--no-names` drops them |
| `node scripts/coach-transcript.mjs <file> --interviewer "Priya,Marcus,Tom" --candidate "Me"` and `parseTranscriptFile` | Yes, when more than one label is the interviewer |
| `POST /api/v1/coach-transcript` | Whatever the poster sends in `name` |
| A live session (`onHeard`) | No: the call's audio is one stream. Nothing in the code makes a name up |

With one interviewer label no name is carried, so a two-person replay reads `INTERVIEWER:` as before.

The plan names the panel in one line, read by `rosterOf` (`coach/roster.ts`):

```text
panel: Priya (hiring manager, runs the panel), Marcus (staff engineer: reliability, payments, data), Tom (engineering director: interrupts and pushes back)
```

The line may start with `panel:`, `panelists:`, `interviewers:` or `who is there:` (any case). People are separated by commas or semicolons outside brackets; what a person judges follows the name in brackets, or after ` - ` or `: `. An entry that is not a capitalised name of at most three words is left out; at most eight people. A plan without the line has no roster.

When there is a roster, or any line is named, the user message gains a block after the plan (and nothing else changes; the system message is the same for every call):

```text
THE PANEL: more than one interviewer is on this call.
- Priya: hiring manager, runs the panel
- Marcus: staff engineer: reliability, payments, data
Rules for a panel:
- Aim the answer at what the person who asked is judging (THE PANEL and the plan say what that is); the others are listening.
- Talk between panelists is nothing to coach: a handover, an audio check ("can you hear me?"), "are we at time", one giving way to another, one answering another. Reply NONE unless the candidate was asked something. When two start at once, answer the one who goes on to ask.
```

The rule for who asked is said with every turn, straight before `NEW LINES` (a model kept in one session is told the block above once, and stopped writing the line when the rule was only there):

```text
PANEL: straight after ASK, add the line FROM: the first name of the interviewer who asked, as the lines name them.
```

With no names on the lines it reads instead: `PANEL: the lines do not say which interviewer spoke (Priya, Marcus, …). Straight after ASK add the line FROM: their first name, but ONLY when the words themselves make it certain who is asking: they were handed to by name, they introduced themselves, or someone addressed them by name around the question, and nobody else has taken over since. Otherwise write no FROM line. Never guess from what was asked.`

Two panelists starting at once, replayed with names (the benchmark's `charged-once`). These lines of the turn reach the model as:

```text
ELENA (interviewer): Can I ask about,
ELENA (interviewer): um,
MARCUS (interviewer): And what about idempotency,
ELENA (interviewer): how you work with product when—
MARCUS (interviewer): if a—
MARCUS (interviewer): Sorry,
MARCUS (interviewer): go ahead,
MARCUS (interviewer): Elena.
ELENA (interviewer): No,
ELENA (interviewer): no,
ELENA (interviewer): you go,
ELENA (interviewer): mine is a longer one.
MARCUS (interviewer): Okay.
MARCUS (interviewer): If a broker double-clicks submit and we get the same payment request twice,
MARCUS (interviewer): how do you make sure they are only charged once?
```

Heard live, the same stretch is fifteen `INTERVIEWER:` lines.

The reply may carry `FROM: Marcus`. `parseCoachReply` keeps it only if it is a name the coach was given for this call (`voiceAmong`): where the turn's lines are named, someone who spoke in that turn; otherwise someone on the plan's roster. Any other name is dropped. A turn in which exactly one named interviewer spoke is marked as asked by them whether or not the model wrote the line. A look at the candidate's own answer (`answer-check`) or at the screen never names anyone. The posted note carries `"from": "Marcus"`, and the notes pane shows it in the note's quiet line: `Technical · from Marcus · 10:44:28`.

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

Other commands: `--runtime codex`, `--hide-me`, `--from`/`--to HH:MM:SS`, `--studio` (also shows the replay's notes in the running Studio, kept apart from yours), `--grounding plain` and `--cite pointer` (the coach as it was before grounding; a replay has both on, as the live coach does). `--trace` prints each prompt, the model's raw reply and each revision of each note.

```bash
printf 'mode: system-design\nRound with the head of platform.\n' > plan.md
node scripts/coach-plan.mjs plan.md        # set; also --show and --clear
node scripts/coach-transcript.mjs talk.txt --interviewer "Speaker 1" --candidate "Speaker 2" --speed 1
node scripts/coach-transcript.mjs --clear
node scripts/coach-note.mjs '{"title":"x","points":["y"]}'   # one note by hand; --clear
```

`coach-transcript.mjs` joins consecutive blocks of one speaker, so Studio sees fewer, longer lines than the replay does. The Studio must be running; the token is `INTERVIEW_API_TOKEN` or `.dev-local/api-token`. For a desktop agent, run Studio with `INTERVIEW_COACH=off`, then loop `pnpm -s coach:listen` (prints one JSON moment: `reason`, `about`, `turn`, `new`, `before`, `plan`, `key`; exit 0 moment, 2 nothing in 10 minutes, 1 Studio unreachable) and post with `coach-note.mjs`. Rules are in `.agents/skills/live-coach/SKILL.md`.

## Benchmarks: the same calls, run after run

Two calls are kept as fixtures in `apps/agent-worker/fixtures/calls/` (its README lists the files). Each has an `expected.json`: the questions, the words that complete each, and the stretches that ask the candidate nothing.

| Call | What it holds |
|---|---|
| `screening-services` | 107 s of a recorded screening call: a slow two-part question, a long answer, a follow-up. |
| `panel-round` | 10 minutes, five interviewers and one candidate. Opens with the stretch above, then a scripted, exaggerated panel: back-channel noises, a handover, "can you hear me?", a question with a 2.8 s pause in it, an interruption, pushback, two people starting at once, a three-part question, a rambling answer, a question taken back, an instruction with no question mark, rapid short questions, a question answered with a question, logistics, salary, the close. |

```bash
pnpm -s coach:bench:timing          # decisions only, a second
pnpm -s coach:bench:panel:timing
pnpm -s coach:bench:claude          # live, under 2 minutes; also :codex
pnpm -s coach:bench:panel:claude    # live, about 10 minutes; also :codex
pnpm -s coach:bench:claude -- --trace   # every prompt, raw reply and note revision
pnpm -s coach:fixture panel-round   # remake a scripted call's transcript from script.json
```

A run prints, per question: whether it was acted on whole, acts on part of it, question end to first line, and looks and nudges during the answer; per quiet stretch: acts and notes shown. It ends with one line in short, keeps its result in `.dev-local/benchmarks/` and compares with the last run of the same call on the same runtime. The `call fixtures` suite in `pnpm test` runs both calls with no model and fails when a question is no longer acted on whole or the early and wasted acts exceed the fixture's `budget`.

`panel-round` names its five interviewers, so a replay of it gives the coach each line under its speaker's name. A call heard live is one stream of call audio with nobody named; `--no-names` replays the panel that way, as a benchmark of its own (`panel-round-unnamed`), so the two are never compared with each other:

```bash
pnpm -s coach:bench:panel:unnamed:timing   # the same decisions: names never change when the coach acts
pnpm -s coach:bench:panel:unnamed:claude   # live, about 10 minutes; also :codex
```

Each question in a panel fixture says who asks it (`from`). A live run prints, per question, who asked and who the note says asked, and ends with how many notes named the right person, the wrong person, and nobody. A note that names nobody is safe; one that names the wrong person is the failure.

### Comparing another way of ending a turn

The replay can hand the question "is this speaker's turn over?" to another mechanism, to compare it with the coach's own reading on the same call and the same scorer:

```bash
pnpm -s coach:bench:panel:timing -- --signals vad
pnpm -s coach:bench:panel:timing -- --signals vad --endpoint <module.mjs> --endpoint-kind <kind> --endpoint-owns --label <name>
```

- `--signals vad` gives every variant the signals as a detector would: a start told 150 ms late, a stop 500 ms late, shorter pauses unheard, text 300 ms after the words. The default, `ideal`, is the recording's exact timings.
- `--endpoint` names a module whose default export returns `{ apply(events, nowMs), ready(role, nowMs), close?() }`. Without `--endpoint-owns` it can only hold the coach back; with it, the coach's own waits after a turn are zero and the mechanism alone ends the turn.
- `--label` keeps each variant's results apart.

One idea was taken from that comparison: where a source says when the interviewer's voice stopped, the coach counts the silence after a turn from the voice, not from when the words arrived (`--no-voice-stop` replays without it). With signals as a detector gives them, the panel's median wait after a question fell from 1.17 s to 0.94 s.

Studio depends on no such mechanism. The comparison with LiveKit's and Pipecat's endpointing lives outside the repository (`~/Downloads/coach-framework-lab/studio/`, 2026-10-10): as a gate each ties with the coach; owning the decision they act about a quarter of a second sooner at best and act more often on what is no question, because they end a turn on silence alone and the coach also reads the words.

## Limits and decisions

- No transcript at rest ([[adrs/ADR-0039-a-live-coach-reads-the-conversation-and-writes-the]]); a verified mark comes from a check in code only.
- Every call goes through the engine's one entry point ([[adrs/ADR-0040-the-ai-engine-is-imported-at-its-one-entry-point]]); agents run only in the worker ([[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]]).
- Facts from the pack share the pointer `/candidate` for name, headline and location, so the coach's lookup by pointer keeps only the last of them (observed in `coach.ts` `known`).
- One transcript and one set of notes per Studio process, not per tenant.
