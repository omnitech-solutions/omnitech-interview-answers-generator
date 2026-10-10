---
title: "The context pack, from an application's material to the facts a reader may cite"
slug: walkthrough-context-pack
type: references
tags: [context-pack, engine, walkthrough, grounding, extraction, stages]
sources: []
last_reviewed: 2026-10-10
---

# The context pack, from an application's material to the facts a reader may cite

Description of: as of 2026-10-10, uncommitted work on master (HEAD `274dea8`), recipe `interview-context` version 3. Every record, tie, count and selection below was produced by running the product's own code on the synthetic fixture `products/interview/fixtures/context-pack/kestrel-freight-pay/` (an invented person, employer and figures) with the scripted model of `bench-prepared.ts`; the one live run is named where it is quoted. Decisions: [[adrs/ADR-0038-prepare-raw-information-into-attributable-context]], [[adrs/ADR-0041-the-first-context-pack-slice-derives-identities-fr]]; the plan and its results: [[briefs/BRIEF-interview-brief-and-context-pack]].

## At a glance

There are two paths, and a model is on only one of them.

```
 PREPARE (a person presses "Prepare" in the Interview form; a model reads)
 matrix + employer brief + posting + each stage's notes, people, transcripts + employer-said + research
        │ applicationSources()                       every stage, unscoped
        ▼
 engine.context.prepare({ recipe v3, sources, profileId, key, links })     a few sources at a time
        ├─ extract (MODEL, one call per piece)  posting · employer-said · research · transcript
        ├─ verify  (code)   a record is kept only if its quote is in the source
        ├─ link    (code, then MODEL in batches)  names · tells · stack   |   fit · proof · story
        └─ keep    (engine) under application:<candidacy>:<member>, in the engine's database or memory
        ▼
 the review (code): counts, refused, unread, withheld, gaps, stages     the person confirms, edits, removes

 READ (the coach, the view, a briefing, a document; NO model)
 today's material ──► engine.context.prepare (code-only recipe) ──► withKept(kept pack) ──► resolve(projection, stage)
        │  a device-only source, and what was extracted from it, is left out unless the reader is the person's own screen
        ├─► coach.ts: facts → "THE CANDIDATE'S RECORD" / "EMPLOYER MATERIAL" → reply.ts checks [pointer]
        ├─► GET …/sessions/:id/context → the window's "Selected for this question"
        ├─► briefing: the `briefing` projection as cited employer lines
        └─► document: the `document` projection beside the cast's roles
```

With no pack prepared, the read path is exactly what it was at recipe version 2: nothing is merged, and every reader has the person's material as it stands.

## Where things live

| What | File (under `products/interview/src/backend/context-pack/`) |
|---|---|
| Kinds, extractors, link steps, projections, aliases | `recipe.ts` |
| The matrix, the employer brief and preferences as records | `sources.ts` |
| Stages, employer-said, research, transcripts and the posting as sources | `brief-sources.ts` |
| Ties made in code, and the same ties as the engine's links | `links.ts` |
| Selection for one question; the arranging of evidence | `pack.ts` |
| One stage of an application | `stage.ts` |
| Preparation by a model, the review, the corrections, the pack's name | `prepare.ts` |
| A kept pack read with today's material | `kept.ts` |
| What a briefing and a document read; the fit map | `readers.ts`, `application.ts` |
| The routes | `routes.ts` |
| The benchmark, its stage and prepared modes, the scripted model | `bench.ts`, `bench-stages.ts`, `bench-prepared.ts` |

Elsewhere: the review contract `packages/interview-contracts/src/pack-review.ts`; where packs are kept `packages/platform-runtime/src/ai-packs.ts`; the host's wiring `apps/web/src/platform/ai.ts` and `products.ts`; the form's card `products/interview/src/frontend/studio/interview-brief/pack-review.tsx`.

## Scenario

Rowan (synthetic) has applied to Kestrel Freight Pay as Tech Lead, Settlements. The application has a posting, a hiring-manager stage (done, with a device-only transcript of five turns) and a technical stage (to come), three things the employer said, three research documents, a 13-role matrix and a 16-note employer brief.

## Step 1: the recipe (version 3)

**Kinds.** The ten of version 2 and four new ones, read from a stage's transcript: `stage-question`, `stage-answer`, `employer-signal`, `stage-commitment`. All four are "about the employer": what was said in a stage is a record of the conversation, and even the person's own answer there is never their approved record.

**Extractors**, one per kind of source a model reads. Each requires a quote, and asks for search words (`themes`) and the questions a record answers (`answers`).

| Extractor | Source kind | Produces | Fields |
|---|---|---|---|
| `posting` | `job-description` | `employer-requirement`, `employer-fact` | `section` (mustHaves, niceToHaves, responsibilities, techStack, team, values, process, companyFacts), `level` (must, nice) |
| `employer-said` | `employer-said` | `employer-fact` | `section` (process, date, constraint) |
| `research` | `research` | `employer-fact`, `prep-note` | `section` (company, product, people, risk, questionsToAsk) |
| `transcript` | `transcript` | the four stage kinds | `askedBy`, `followUps`, `used`, `missing`, `expect`, `carriesTo` |

**Link steps.** A step is from one kind to others, and the engine refuses a tie between any other kinds. No step ends at a kind of the employer's.

| Step | From → to | Made by |
|---|---|---|
| `names` | prep note → achievement | code: an employer the note names, a figure it states |
| `tells` | story → achievement | code |
| `stack` | requirement → achievement | code: a technology the requirement names, done by the person |
| `fit` | requirement → achievement, with `strength` (strong, partial, gap) and a `note` | model |
| `proof` | prep note → achievement | model |
| `story` | stage question → story or achievement, with `rank` (primary, backup) | model |

**Projections.** `coach` (3 of each kind), `answer` (6) and `inspect` (24) share one slot list: stories, requirements, prep, asked, signals, evidence, roles, preferences, employer. Evidence comes after the slots whose ties it follows. `document` reads requirements, every role and every achievement whole (up to 1,200 characters). `briefing` reads one stage: people, stories, requirements, prep, asked, signals, answered, commitments, evidence, employer.

`CODE_ONLY_RECIPE` is the same recipe with no extractor and no step asked of a model. Every reader prepares with it.

## Step 2: preparing (a model reads)

`applicationSources` gives every source of the application. The posting is one source (`posting:<candidacy>`, no records, the text); research and employer-said carry their text beside their line records; a transcript carries its turns as pieces named by their clock (`10:02:10-10:02:24`), `policy: "device-only"` when it may not leave the machine, and `scope: "stage:1"`. Where the application has a posting, the employer brief's copy of it (must-haves, stack, responsibilities, company facts, values, summary, team, format) is left out: the posting is read itself.

`prepareApplicationPack` gives the engine three sources at a time, so a person sees progress and stopping loses nothing already read. On the fixture with a profile declaring 200,000 tokens:

```json
{"sources":16,"extracted":8,"reused":0,"pieces":8,"calls":8,"linkCalls":4,"kept":55,"rejected":3,"holes":0,"links":359,"linksReused":16}
```

One requirement and one question as kept:

```json
{"id":"posting:…b001:0973bd126d21d282","kind":"employer-requirement","text":"React for internal and customer-facing tools",
 "fields":{"section":"mustHaves","level":"must"},
 "source":{"id":"posting:…b001","revision":"50dab81e09a39be4","locator":"chars:1743-1787","quote":"React for internal and customer-facing tools"},
 "by":"model","verified":"quote-found","themes":["react"]}

{"id":"stage:…a001:transcript:…e001:137f8d5c5e58c6a9","kind":"stage-question","text":"When two teams both need the same payout record, who should own it?",
 "fields":{"askedBy":"Interviewer"},
 "source":{"id":"stage:…a001:transcript:…e001","revision":"614312d9f33496ea","locator":"10:02:10-10:02:24","quote":"when two teams both need the same payout record, who should own it"},
 "by":"model","verified":"quote-found","themes":["ownership","data"],"scope":"stage:1"}
```

What the scripted model invented was refused and listed:

```json
{"sourceId":"stage:…a001:transcript:…e001","reason":"the quoted words are not in the source","code":"quote-not-found","extractor":"transcript","kind":"stage-commitment","text":"Promised to send a write-up of the Quotewright adapter contract."}
```

The ties for that requirement, and the counts by step (359 in all):

```json
[{"step":"fit","from":"posting:…:0973bd126d21d282","to":"role:trailmark-telematics:…:responsibilities:9ff9f7d0331a","fields":{"strength":"strong"},"by":"model","verified":"ends-exist"},
 {"step":"fit","from":"posting:…:0973bd126d21d282","to":"role:quotewright:…:responsibilities:8fca0074cb1a","fields":{"strength":"partial"},"by":"model","verified":"ends-exist"}]
```

| Step | Ties | By a model |
|---|---|---|
| `tells` | 195 | 0 |
| `names` | 130 | 0 |
| `fit` | 26 | 26 |
| `proof` | 5 | 5 |
| `story` | 3 | 3 |

The scripted model also proposed evidence as the requirement, a requirement as evidence for another, and an end that does not exist: each was refused (`forbidden-pair`, `forbidden-pair`, `end-missing`).

**Any size.** The same application with a profile declaring 1,500 tokens: 10 pieces, 10 extraction calls, 154 link calls, the same 55 records with the same quotes and locators, the same ties. The link calls are what a small window costs: 139 achievements are shown a few at a time against each group of requirements, notes and questions.

**A device-only transcript.** With a profile that does not run on this machine the engine skips the transcript before any call: 7 extraction calls, no call carries a word of it, and the pack has a hole `{ reason: "locality", failure: { code: "refused", refusal: "policy" } }`. A profile with `locality: "device"` reads it. When a remote profile prepares after a local one, what the local one extracted from the transcript is set aside before any call and put back after (`prepare.ts`, `onDevice`): the remote model is asked for ties and is shown none of it.

**A piece that fails.** The engine asks again at half the size; a half that fails again is a hole (`not-extracted`) and the pack is still made. Within one preparation a failed source is not asked about again in the later groups (`prepare.ts` sets the hole aside and puts it back at the end); the next preparation reads only that source.

**Preparing again.** Nothing changed: no call. One research document changed: one call (its extraction; a tie is asked for only for a record that is new). "Read again" for one source reads that source though it has not changed.

## Step 3: the review, and correcting

`reviewPack` is code. For the fixture:

| Kind | Records | Read by a model |
|---|---|---|
| candidate-achievement | 139 | 0 |
| employer-fact | 38 | 21 |
| employer-requirement | 28 | 28 |
| prep-note | 30 | 1 |
| stage-question, stage-answer, employer-signal | 2, 2, 1 | all |
| transcript-turn | 5 | 0 |

The fit: 14 things asked of a candidate (must and nice), 8 with strong evidence, 5 partial, 1 gap ("Working proficiency in French, for brokers in Quebec": "Nothing in the record says French…"), 3 ties refused. A gap's tie is never followed as evidence. The review also lists what was refused with its reason, the parts not read, the sources not sent off this machine, each stage's material (a stage with no notes and no transcript says so), and each source's state: read, changed since it was read, not read yet, kept on this device, partly read, or the person's own material.

`POST …/context-pack/corrections` passes `confirm`, `edit` and `remove` to `engine.context.correct`, which keeps them with the pack. A removed record stays out and an edited one stays as written when the source is read again and the model proposes both anew.

Routes, under `/api/interview/documents/candidacies/:id/context-pack`: `GET` (the review), `POST /prepare` (NDJSON: `progress` lines, then `done` with the review, or `error`), `POST /corrections`. Another member and another workspace get `not-found`; a member who may only read gets the review and no more. The form's "Context pack" card shows all of it.

## Step 4: reading (no model)

A reader prepares today's material with the code-only recipe, as before, and `withKept` adds what of the kept pack still stands:

- a record a model extracted, while its source is at the revision it was read at (a changed source's records are not read until it is prepared again);
- a model's tie, while both its ends are there;
- what the person removed (left out) and edited (says what they wrote).

**Who is reading.** `prepareContextPack` takes `reader: "device" | "remote"`, and the default is remote. A remote reader's prompt goes to a model that does not run on this machine, so a device-only source is left out before anything is prepared, and every kept record and tie that rests on one is removed. Only the person's own screen reads as "device": the session's Context view and the pack review card. The coach, a briefing and a document are remote.

It leaves out the employer brief's copy of the posting once the posting is read, and a raw research or employer-said line that an extracted record quotes. An extracted requirement is tied to the person's technologies by the same code as any requirement.

**Selection.** The evidence slot follows every link step, so the engine keeps an achievement tied to what the earlier slots selected in its ranking; `arrange` (pack.ts) then fills the places. The rules of version 2 stand (linked first for the person's own notes and stories, two roles, the primary dominating). One rule is new: **a model's tie breaks a tie and never outranks an achievement that answers the question itself.** It is an inference one step away from the question. Tried the other way (a model's fit ranked as a named employer is), the prepared pack lost "a production incident", "an API contract", "how do you mentor" and "your testing strategy" to evidence for a requirement or note that only shared a word with the question.

**Stage, and carry-forward.** What a transcript gave belongs to its stage (the engine's scope). Resolved for stage 2 with `{ is: "stage:2", earlier: ["stage:1"] }`, stage 2's own questions lead and stage 1's follow; resolved for stage 1, a stage-2 transcript is no part of the pack. That carry-forward is for a transcript that may leave this device: pasted or attached and allowed out, or recorded under a permitted policy. The fixture's hiring-manager call is a device-only recording, so a remote reader of stage 2 is given nothing of it, and the Context view on the person's own screen is given all of it. The person's own notes keep the version-2 rule (relevance first, the stage as the tie-break).

For "When two teams both need the same payout record, who should own it?" in the technical stage, the coach projection selects (shortened; as the Context view shows it on the person's own screen, or as any reader has it once the transcript may leave the device; a remote reader of the device-only recording has every line but `asked`):

```
requirements  posting:…@chars:2292-2341      Experience introducing delivery metrics to a team
prep          /stages/…a002/notes/2          Data ownership: one writer per table; Settlements owns payout state; …
asked         …e001@10:02:10-10:02:24        When two teams both need the same payout record, who should own it?
evidence      /roles/4/proof_points/1        At Pledgewell (2021, …): Helped a team of five move to weekly delivery
roles         /roles/4                       Senior Full Stack Developer, Pledgewell (2021)
employer      posting:…@chars:702-778        The Tech Lead leads six engineers and works beside a product manager and a designer
employer      employer-said:…d001@chars:0-129  The technical round is two hours: one hour of live coding …
```

An extracted fact's pointer is its source and the place of its words, since two sources both have a character 120. The evidence here is found by the words "two teams" and is wrong for the question; the benchmark's section says what the prepared pack does and does not fix.

## Step 5: the readers

**The coach** (`coach/context.ts`) loads the kept pack for the session's application once a minute, beside the material. It reads as a remote reader: its prompt is sent to Claude Code or Codex. For a transcript that may leave this device, the stage-1 question and signal reach its prompt under `EMPLOYER MATERIAL (not the candidate's experience)`; of a device-only recording nothing does; `known`, the facts a claim is verified against, holds the candidate's and the preferences' only, so a claim citing the transcript is `inferred`. In the agent worker the pack is read from the engine's database (`AI_ENGINE_DATABASE_URL`); with none the worker cannot see the web server's memory and the coach reads the material as it stands.

**A briefing** is not tied to an application: it names a company, a role and a stage. `application.ts` reads the pack only when exactly one of the member's applications is to that company for that role, resolves the `briefing` projection for the stage of that kind, and gives the writer lines under `/context/pack/<group>/<n>` as employer material: people, asks ("Required: …; Evidence (strong): /roles/3/responsibilities/2" or "…; GAP: no evidence in the candidate's record. …"), what earlier stages asked, signalled, heard answered and were promised (never from a device-only transcript: a briefing reads as a remote reader, and so does a document), the notes, the employer's facts.

**A document** gets a `pack` in each writing call's prompt: the asks with their evidence by pointer and the gaps, and the achievements of the roles its own blocks were cast with. The cast (`cast.ts`) and the verification (`verify.ts`) are unchanged; with no pack the prompt is byte for byte what it was.

Both gather the fit map with the engine's `find` and `related` themselves, because an agent runtime (Claude Code, Codex) runs its own tools and cannot be offered the pack as one.

## Where a pack is kept

Under `application:<candidacy id>:<member id>`, per workspace and product, by the engine: in its own database when `AI_ENGINE_DATABASE_URL` is set (the web server prepares, the worker's coach reads), in the web server's memory otherwise (lost on restart, unseen by the worker). The Studio's database has no table for it. The profile that prepares is `INTERVIEW_PACK_PROFILE`, else the agent the assistant runs on, else `agent/claude-code`; its calls run in the agent worker as agent jobs, like a document's.

## Try it

```bash
pnpm pack:bench                  # code only: the first benchmark
pnpm pack:bench --stages         # code only, per stage
pnpm pack:bench:prepared         # the whole application prepared by the scripted model, large and small
pnpm pack:bench:claude           # the same, by Claude Code (also :codex, :openrouter, :lmstudio, :all)
pnpm exec vitest run products/interview/src/backend/context-pack
```

In the Studio: open an application's Interview form, scroll to "Context pack", press Prepare.

## The benchmark on the fixture

| Measure | Code only (phases 0 to 2) | Prepared, scripted model |
|---|---|---|
| Right evidence first | 24 of 28 | 25 of 28 |
| Right prep note first | 23 of 27 | 23 of 27 |
| Wrong-employer evidence in the first three | 2 of 28 | 2 of 28 |
| Requirements found; invented | none read | 14 of 14; 0 |
| Model-written records with a verified quote | none | 55 of 55 |
| Requirements with evidence linked; wrong links | none | 13 of 14; 0 |
| Stage carry-forward to a remote reader, transcript as recorded (device-only) | 0 of 3 | 0 of 3, withheld |
| Stage carry-forward to a remote reader, transcript permitted remote | 0 of 3 | 3 of 3 |
| Model calls, large; small; after one source changes | 0 | 12; 164; 1 |
| Resolve per question (median) | about 2 ms | about 6 ms |

The one gain on evidence is "Why Kestrel?", whose note names no employer and to which the model ties the multi-carrier quoting work. Still wrong, prepared or not: "a payout never sent twice" (no word of the question is in the record or the notes), "ingestion for large files from a bank" and "a partner API is slow or down" (the fit for the leading requirement is right and only breaks ties; an achievement sharing more words leads).

## Limits

- The person's notes are not read by a model: a note is one record per line, made in code, and the engine's extraction makes new records and cannot label an existing one. A model ties a note to its proof (`proof`); it does not add the questions a note answers.
- `stage-answer` says what the answer drew on as words (`used`); it is not tied to an achievement.
- A briefing reaches an application only by its company and role as typed.
- The session view lists a later stage's raw turns as left out for scope, not the records extracted from them (they are no part of an earlier stage's pack).
- The card and the routes are proven by their suites; the running window was not looked at.
