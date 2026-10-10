---
title: "The interview brief and its context pack: one application, every stage, prepared by an AI workflow and checked by code"
slug: interview-brief-and-context-pack
type: brief
status: draft
created_at: 2026-10-10
updated_at: 2026-10-10
authors: ["desoleary", "claude"]
tags: [context-pack, interview-brief, stages, extraction, ai-engine, benchmark]
related_adrs: [ADR-0007, ADR-0037, ADR-0038, ADR-0040, ADR-0041]
---

# The interview brief and its context pack

This is the highest priority after the technical round's preparation (owner, 2026-10-10).

Consumes: [[research/references/context-pack/worked-example-zensurance]] (the real inputs, the
real baseline and a full example of the finished pack; read it first) and
[[research/references/walkthrough-context-pack]] (the mechanism as built, on synthetic data).
Builds on ADR-0038 (the engine prepares and resolves context) and ADR-0041 (the first slice and
its four open choices).

## 1. The idea in five sentences

An **interview brief** is everything a person has for one application: who they are (the
experience matrix), what the job is (the posting), what the employer said, what they found out
(research), and, **for each stage**, who they will meet, what they prepared, and afterwards
what was actually said (a transcript). A **context pack** is that brief turned into small typed
facts, each traceable to the sentence it came from, with links between a requirement, the
evidence that proves it and the note that answers it. Turning one into the other is an **AI
workflow**: models extract and link, and code checks every result before it is kept. Every
feature (the live coach, an answer, a document, a briefing) then reads the same pack through a
named **projection**, so what a model was given is always something a person can inspect. A
model may only assert what it can point at, and code checks the pointer.

## 2. What exists today (the baseline)

Built (ADR-0041): a recipe of nine record kinds and three projections (`coach`, `answer`,
`inspect`); three sources (matrix, employer brief, preferences) turned into records by code;
`engine.context.prepare` and `resolve`; a route and a window pane showing "Selected for this
question"; the coach reading it and verifying citations. One AI step exists upstream: a model
cleans the posting and notes into the employer brief.

Measured on the real Zensurance application (ten questions, coach projection; the table is in
the worked example, section 4):

| Measure | Today |
|---|---|
| Records | 279 (172 of them evidence fragments) |
| Right prep note first | 6 of 10 |
| Right evidence first | 1 of 10 (1 more partly) |
| Questions with nothing useful | 2 of 10 (salary, conflict) |
| Stages with their own material | 0 of 2 |
| Records traceable to a source sentence | matrix records only; no employer line |
| Research and transcripts in the pack | none |
| Kept between requests | no (rebuilt each minute) |
| Model calls to prepare | 0 (1 earlier, for the employer brief) |

Seven causes are listed there. The three that matter most: evidence is stored as fragments;
matching is by shared words only; nothing links a requirement, a note and its proof.

## 3. The brief: what a person enters, and where it lives

One application, several stages. New things are marked.

| Part | Fields | Today | Change |
|---|---|---|---|
| Candidate | the experience matrix revision; preferences (notice, pay, how they work) | matrix yes; preferences typed per session | preferences kept with the profile |
| Application | company, role, posting URL, **job description** | `candidacies` | unchanged |
| **Employer said** | what the employer or recruiter told you, each with a date and who said it (an email, a call note) | one "employer notes" text on the briefing form | a list of dated entries; replaces the confusing "employer notes" |
| **Research** | a folder of documents per company and per application (a file, a pasted page, a link's text), each with where it came from | one text field on the briefing form; `companies.research` empty | a folder of research documents the pack consumes |
| **Stages** (1..n) | kind, label, when, minutes, format; **people** (name, title); **the person's prep notes for this stage**; **transcripts** of this stage (one or more); **outcome** (what happened, what comes next) | `interviews` rows with kind and label; participants table empty; notes are one text for the whole application; no transcript, no outcome | notes, transcripts and outcome per stage |
| Request | what the person wants from this preparation | briefing form | per stage |

A transcript recorded by the Studio's "Record transcript" button can be attached to a stage with
one action; a file can be uploaded; either stays on this machine unless the stage's policy
allows processing elsewhere (the device-only rule is unchanged: a device-only source is never
sent to a remote model, and the workflow says which sources it could not read and why).

## 4. The workflow that prepares a pack

Seven steps. A step is either code (deterministic, free, instant) or a model call
(schema-constrained through the engine, checked by code afterwards). Each step's output is
stored against the hash of its inputs, so only what changed is done again.

```
 gather ─► split ─► extract ─► compose ─► link ─► review ─► store
 (code)    (code)   (MODEL)    (code)     (MODEL)  (code)    (code)
```

1. **Gather (code).** Read every part of the brief in the owner's scope. Give each a source id,
   a revision and a SHA-256. Refuse what the session's policy does not allow to leave the
   machine, and say so.
2. **Split (code).** Cut long text into pieces that keep their place: a posting by heading and
   paragraph (character offsets), a transcript by speaker turn (clock times), research by
   section. Each piece is small enough for the model that will read it (step 3 says how).
3. **Extract (model, one call per piece or per source).** A typed, schema-constrained answer per
   source kind:
   - posting → requirements (must, nice), responsibilities, stack, team, values, process;
   - employer-said → process facts, dates, constraints ("no AI assistants during live interviews");
   - research → company facts, product, people, risks, questions worth asking;
   - a stage's notes → prep notes, each labelled with the questions it answers and the proof it names;
   - a stage's transcript → the questions asked (and by whom), what the person answered, what
     was promised, what the interviewer pressed on, what to expect next.
   **Every extracted record carries the exact quote and where it is.** Code then looks for the
   quote in the source (case and whitespace tolerant). Found: kept. Not found: rejected and
   listed for the person. This is the coach's verification rule applied at preparation time.
4. **Compose (code).** Candidate facts are not written by a model. Code turns the matrix's
   fragments into whole achievements: role + responsibility or proof point + its metric + the
   technologies, one sentence each, with every part's locator. The fragments stay available.
5. **Link (model, small).** Given the requirements and the achievements (titles only, in
   batches), a model proposes, for each requirement: the evidence that proves it, how strongly
   (strong, partial, gap), and what to say about a gap. For each prep note: the achievement it
   names as proof. For each likely question: a primary and a backup story. Code checks that both
   ends of every link exist and that no employer fact is ever linked as the candidate's
   experience. A model also adds search words (`themes`) to a record from a closed vocabulary
   grown from the matrix's own tags, which is what lets "migration" find "modernization".
6. **Review (code, then the person).** Counts by kind, the rejected records with reasons, the
   requirements with no evidence (the real gaps), the stages with no material. The person can
   confirm, correct or remove a record; a correction is kept and survives a re-preparation.
7. **Store (code).** The prepared pack is kept by the engine (`prepared_context`, which exists)
   under the application, with its sources' revisions. A change to one source re-does only that
   source's extraction and the links that touch it.

### Any model, any size

The workflow must not depend on a model that can hold everything.

- The engine already knows a profile's limits. Step 2 sizes its pieces from the chosen model's
  context window and output limit (the engine's `budgetFrom`), so a large model (Claude Code,
  Codex) gets a whole posting or transcript in one call, and a small one (a free OpenRouter
  model, a local LM Studio model) gets it in pieces.
- Extraction is a **map**: pieces are independent and run in parallel up to the provider's
  limit. Merging is a **reduce in code**: records are identified by a hash of their kind and
  text, so the same requirement found in two pieces is one record with two quotes.
- Linking is batched the same way (requirements in groups against achievement titles), so it
  never needs the whole pack in one prompt.
- A piece that fails (a malformed answer after the engine's repair turn, a refusal, a timeout)
  is retried once smaller, then recorded as not extracted with its reason. The pack is still
  made, with that hole stated in the review.
- Proof required before this is called done: the same brief prepared with (a) Claude Code,
  (b) Codex, (c) one free OpenRouter model, (d) LM Studio `qwen/qwen2.5-coder-14b`, each scored
  on the benchmark in section 7. A smaller model is allowed to find fewer records; it is not
  allowed to keep an unverified one.

## 5. How a model is given the pack

Two ways through the same recipe (the worked example, section 6, shows both):

- **Selection in code**, for the coach and any small model: a projection is resolved for the
  question using its words, the records' themes and "answers" labels, the links (a chosen
  requirement brings its evidence; a chosen note brings its proof) and the stage (this stage's
  records first, then what earlier stages learned). The model reads a short list of facts with
  pointers and cites them.
- **The pack as a tool**, for a model with tools and a large context: it is given the index and
  three read-only calls (`find`, `get`, `related`) and decides what to read. Used for
  documents, briefings and long answers.

In both, code verifies each citation against the fact it names. New projections: `document`
(the roles cast for a resume, with their achievements whole), `briefing` (one stage: people,
what they judge, the fit map, the gaps, what earlier stages asked) and `stage` as a filter on
all of them.

## 6. What changes in the code, by layer

| Layer | Change |
|---|---|
| Contracts | stage material (notes, transcripts, outcome, people), employer-said entries, research documents; record kinds `candidate-achievement`, `stage-question`, `stage-answer`, `employer-signal`, `fit`; `source.quote`; the review summary |
| Database | columns or tables for stage notes, transcripts (text kept encrypted like other private content, or a pointer to the recorded file), outcome; research documents; employer-said entries; one Drizzle migration; nothing raw |
| Engine | a `prepare` that accepts a product's extractors and a model profile, sizes pieces by budget, maps, reduces and verifies quotes; keeps prepared context by source hash; the three read-only tools over a prepared pack. Decided by the engine's own rules (a case run against both versions, `contract.md` in the same change, an ADR) |
| Product | the extractors' schemas and instructions per source kind (the product owns meaning; the engine owns mechanics, ADR-0014 in the engine); composing achievements from the matrix; the linking step; the new projections |
| UI | the Interview form with stages, each with people, notes, transcripts and outcome; a research folder; the pack's review (counts, rejected, gaps), all from the UI library's parts |
| Readers | the coach (stage-aware), answers, documents (the cast and verification already being built read the same achievements), briefings |

ADR-0041's blocking choice, where prepared context is kept, is settled here as: in the engine's
`prepared_context`, in the engine's own database in development and in the host's database in
production through the host's migration, per ADR-0016 of the engine. It needs the owner's yes.

## 7. How improvement is measured

A benchmark, like the coach's: a fixed brief, fixed questions, a score, compared run to run.

- **Fixture:** a synthetic brief shaped like the Zensurance one (invented names and figures),
  with two stages, a posting, three research documents, stage notes and one transcript, plus a
  gold file: for each of 30 questions across both stages, the records that should be selected
  first; for the posting, the requirements a careful reader finds; for the transcript, the
  questions actually asked.
- **Scores:** right evidence first (today 1 of 10 on the real material); right prep note first
  (6 of 10); questions with nothing useful (2 of 10); requirements found against the gold list
  (recall) and requirements kept that are not in the posting (must be 0); records with a
  verified quote (must be 100% of model-written ones); requirements with evidence linked; wrong
  links (an employer fact offered as experience: must be 0); stages with material; time and
  model calls to prepare; time to re-prepare after one source changes; characters handed to the
  model per question.
- **Commands:** `pnpm pack:bench:timing` (code only), `pnpm pack:bench:claude`, `:codex`,
  `:openrouter`, `:lmstudio`; results kept and compared with the last run, as the coach's are.
- **The first row of the comparison is the baseline above**, re-run on the fixture before any
  change, so every later number has something to stand against.

### Baseline on the fixture

Measured 2026-10-10 by `pnpm pack:bench` on the fixture
`products/interview/fixtures/context-pack/kestrel-freight-pay/` (13 roles, a 16-note employer
brief, 5 preference lines, 40 gold questions over two stages), with the pack code as it stood at
`f3521a1` (recipe version 1), before any change. Section 10 has the same table after phase 1.

| Measure (coach projection) | Fixture, before | Real material, before |
|---|---|---|
| Records | 265 (161 evidence fragments) | 279 (172 evidence fragments) |
| Right evidence first | 16 of 28 | 2 of 10 (1 right, 1 partly) |
| Right evidence in the first three | 16 of 28 | 2 of 10 |
| Right prep note first | 14 of 27 | 6 of 10 |
| Right preference first | 3 of 3 | none typed |
| Questions with nothing useful | 1 (of the 2 that honestly have nothing; the other found a "background job") | 2 (salary, conflict) |
| Wrong-employer evidence in the first three | 10 of 28 | 4 of 10 |
| Characters per question (median, largest) | 1,255 and 2,017 (answer: 1,657 and 3,103) | 1,273 and 2,056 |
| Time to prepare; to resolve one question | 6 ms; 1.6 ms median | 7 ms; 2.8 ms median |

The fixture is easier than the real material on evidence (57% against 20%) because half its
questions are technical ones whose words the matrix shares. It fails on the same questions for
the same reasons: on the nine hiring-manager questions that mirror the real ten (yourself, why
this company, proudest project, a migration, carrier APIs, MongoDB to PostgreSQL, NestJS, DORA,
mentoring) the right evidence led on 3, and "a migration", "MongoDB to PostgreSQL" and "NestJS"
each put a wrong employer in all of the first three places.

## 8. Order of work, and how it is run

The owner's session orchestrates; workers build; nothing is committed on a red gate.

| Phase | What | Proof | Size |
|---|---|---|---|
| 0 | The benchmark and fixture; the baseline measured on it | the baseline table reproduced by a command | S |
| 1 | Achievements composed from the matrix; themes; a requirement or note brings its linked evidence (links from the notes' own "Proof:" wording, in code) | right evidence first rises on the fixture with **no model call** | M |
| 2 | Stages as things: people, notes, transcripts, outcome; research folder; employer-said; the form | a second stage has its own material; the pack filters by stage | M |
| 3 | Extraction with quotes and code verification, for the posting and research; sized to the model; map and reduce | every model-written record has a found quote; the four models pass | L |
| 4 | Transcript extraction (questions, answers, signals) and carrying them to the next stage | the technical stage's pack includes what the hiring manager pressed on | M |
| 5 | Linking by a model (the fit map and gaps); the review screen | requirements with evidence; zero wrong links | M |
| 6 | The pack kept by the engine and re-prepared incrementally; the read-only tools; `document` and `briefing` projections; documents and briefings read the pack | a change to one research file re-does one extraction | L |

Phase 1 needs no model and no schema change and should lift the worst number first. Phases 0
and 1 can start now. Phases 2 and 3 need the decisions below.

## 9. Decisions (taken 2026-10-10; the owner delegated them and asked for every phase to be built)

1. **"Employer said"** replaces "employer notes": dated entries, each with who said it and how
   (email, call, message). The old single text is carried over as one undated entry.
2. **Research is kept in the database**, as documents belonging to a company or an application,
   tenant-scoped and private like every other piece of the person's content. A file or a pasted
   page is imported into it; nothing is read from a folder on disk at run time.
3. **A stage's transcript is kept as text**, private and owner-only, because extraction must be
   repeatable when the recipe improves. A transcript recorded under a device-only policy is
   kept and shown but is never sent to a remote model: its extraction runs only on a local
   model, or not at all, and the review says so.
4. **Prepared context is kept by the engine**, in the engine's own database
   (`AI_ENGINE_DATABASE_URL`, the one that already holds the record of calls). With none
   configured the pack is prepared in memory and nothing is kept, as today. Studio's own
   database gains no engine table.
5. **The small-model proof** uses a configured, ordered list of free OpenRouter models; a run
   takes the first that answers and records which. LM Studio uses `qwen/qwen2.5-coder-14b`.
6. **All phases are built now.** Phases 0 and 1 first (running), phase 2 and the engine's part
   of phase 3 in parallel with them, then phases 3 to 6 in the product.
7. **Live proof**: `pnpm pack:bench:<model>` commands that can run side by side (each writes its
   own result file and uses its own model session), and a "run them all" command.

## 10. Result of phases 0 and 1 (2026-10-10)

No model is called anywhere in either phase, no schema changed, and the engine was not changed.

### The benchmark (phase 0)

- **Fixture:** `products/interview/fixtures/context-pack/kestrel-freight-pay/`: `matrix.json`
  (13 roles of the real shape, a consultancy with five client roles marked `engaged_through`, 8
  stories, the other top-level sections), `employer-brief.json` (the real shape, 16 prep notes of
  the "Topic: answer shape; Proof: employer" kind), `preferences.txt`, `gold.json`. Every name,
  employer and figure is invented. It is kept as files beside the product, not in `fixture.ts`,
  because the same reader takes a person's own files from outside the repository.
- **Traps it holds**, each one seen in the real material: a 2008 role filed under "migration"
  while the right answer says "modernization"; a note that says "Proof: Copperleaf" while an
  older role lists both databases; NestJS, which the matrix never says, tied to one employer
  only by a note about something else; a "Tell me about yourself" note whose "20% mentoring" is
  also another role's metric; a "Why this company" note that names no employer; salary and
  conflict questions with no word of the material in them; two questions with no answer at all.
- **Gold:** 40 questions (20 hiring manager, 20 technical). A right answer is named by what it
  says, never by a record's id: evidence by its employer (and, where one achievement matters,
  words it must contain), a prep note or a preference by the words it starts with.
- **Commands:** `pnpm pack:bench` (also `pnpm pack:bench:timing`) scores the `coach` and `answer`
  projections, prints them beside the last run and keeps the result in `.dev-local/benchmarks/`
  (scores and pointers only, never the text of a fact). `--show ID[,ID]` prints what the coach
  is given for a question. A brief kept outside the repository is scored with
  `--matrix FILE --brief FILE --gold FILE [--preferences FILE]`; `--brief` may be an application
  row holding `employer_brief`.
- **Gate:** `products/interview/src/backend/context-pack/bench.test.ts` runs the benchmark on
  the fixture and asserts the "after" column below as floors.

### Before and after

Coach projection. The answer projection scores the same on every count; its characters are
given in the last row.

| Measure | Fixture before | Fixture after | Real before | Real after |
|---|---|---|---|---|
| Records | 265 | 243 (139 whole achievements) | 279 | 275 (168 achievements) |
| Right evidence first | 16 of 28 (57%) | **24 of 28 (86%)** | 2 of 10 | **6 of 10** |
| Right evidence in the first three | 16 of 28 | 24 of 28 | 2 of 10 | 6 of 10 |
| Right prep note first | 14 of 27 (52%) | **23 of 27 (85%)** | 6 of 10 | **9 of 10** |
| Right preference first | 3 of 3 | 3 of 3 | none typed | none typed |
| Questions with nothing useful | 1 | 2, the two that honestly have nothing | 2 | 1 (salary: no preference is typed) |
| Wrong-employer evidence in the first three | 10 of 28 | **2 of 28** | 4 of 10 | 2 of 10 |
| Characters per question (median, largest) | 1,255; 2,017 | 1,605; 2,421 (+28%, +20%) | 1,273; 2,056 | 1,445; 2,445 (+14%, +19%) |
| Answer projection, characters | 1,657; 3,103 | 2,101; 3,471 (+27%, +12%) | 1,815; 2,999 | 1,699; 3,430 |
| Time to prepare; to resolve | 6 ms; 1.6 ms | 19 ms; 2.1 ms | 7 ms; 2.8 ms | 21 ms; 2.7 ms |

The ten questions of the worked example, on the real material, after:

| # | Question | Evidence chosen (first three) | Right? | Prep note chosen (first) | Right? |
|---|---|---|---|---|---|
| 1 | Tell me about yourself. | Helcim, then Relay Platform (the employers the note names) | yes (was none) | "Tell me about yourself" | yes |
| 2 | Why Zensurance? | none | no (the note names no employer) | "Why Zensurance" | yes |
| 3 | Tell me about a time you led a migration. | Helcim | yes (was Shaw, 2008) | "Modernization, recent work, leadership" | yes (was "Round") |
| 4 | Third-party carrier API integrations? | Relay Platform | yes | "Third-party integrations, carrier APIs" | yes |
| 5 | MongoDB to PostgreSQL? | MajorClarity, the achievement whose figure the note states first | yes (was Cisco) | "MongoDB to PostgreSQL, data consistency" | yes |
| 6 | Experience with NestJS? | Helcim (through the note that says NestJS beside Helcim) | yes (was PeopleWell) | "NestJS" | yes (was "Round") |
| 7 | DORA metrics with a team? | Kickbooster | no (the note names no employer; "team" is all that matches) | "DORA, mentoring, disagreement" | yes |
| 8 | Salary expectations? | none | no (no preference is typed) | none | no |
| 9 | A conflict with a stakeholder? | Hubstaff, one line that says "stakeholders" | no by the table's standard (there is no conflict story) | "DORA, mentoring, disagreement" | yes (was none) |
| 10 | First 90 days? | Helcim | yes (was partly) | "First 90 days and AI" | yes |

**Targets.** Right evidence first at least 70%: 86%. Wrong-employer evidence in the first three
near zero: 2 of 28. Right prep note first at least 85%: 85%. The two honest "nothing" questions
still nothing: yes, and no other question is empty. Characters no more than a third larger:
+28% (coach), +27% (answer).

**What still fails on the fixture, and why** (none of it was tuned away):

- Evidence: "Why Kestrel?" (the note names no employer, as the real "Why Zensurance" note does
  not); "How do you make sure a payout is never sent twice?" (no word of the question is in the
  record: it needs a reader to know that is idempotency); "ingestion for large files from a
  bank" (finds webhook ingestion at one role, not the bulk importer at another); "a partner API
  is slow or down" (finds the roles that say "partner" and "API", not the carrier adapters).
- Prep notes: two ties between two notes headed with one word of the question each ("service"
  against "testing"; "heavy" against "forms"), broken by nothing better than the record id; two
  questions with no word of the right note in them.

### How an achievement is composed (`sources.ts`)

One `candidate-achievement` per proof point, leadership signal, responsibility and unattached
metric, as one line: `At <employer> (<period>, <title>): <the statement>[; <its metric>].
Stack: <the role's first three technologies>.` Everything in it is the matrix's own words.

- **A metric belongs to a statement** that states its value as a whole ("120ms", never the "6"
  inside "65%"), or failing that says every word of its label. Proof points are tried before
  responsibilities; a leadership signal carries none; a metric that fits nothing stands as an
  achievement of its own with its role. The metric is written after the statement unless the
  statement already says its value and every word of its label.
- **Fields:** `technologies` (those its own words name), `stack` (the role's), `themes` (the
  role's own tags, patterns, problem spaces and system types that its words say at least half
  of: a closed vocabulary), `tags` (all of the role's), `parts` (each part's section, locator
  and own words) and `of` (its role).
- **Identity and pointer** are the statement's own, as before (`<role>:<section>:<hash>`,
  `/roles/3/proof_points/1`), so a pointer still opens the same place.
- **The fragments are dropped as records**, not kept unranked. A fact a model was never shown
  cannot verify a claim, so keeping them would add nothing to verification and would let a
  pinned fragment put a context-free figure back; every part stays addressable in `parts`.
- **Verification is unchanged and still exact**: the coach checks a claim against the text and
  pointer it was given, and that text now holds every figure of the statement and of its
  metric. A suite proves it on what the coach is really given (`coach/context.test.ts`): a
  figure verifies under the statement's pointer, an invented figure does not, and a pointer to a
  part that is no longer a fact of its own does not.

### The rules, as written (`recipe.ts`, `links.ts`, `pack.ts`)

1. **Where a word was found says how much it means.** Evidence: a technology the achievement
   names, or its employer, counts 3; a theme or the role's stack 2; a role-wide tag or the text
   1; the period 0. Notes, requirements, employer facts and preferences: a word in the
   **heading** (the words before a sentence's colon, at most eight; "Proof:" is not a heading)
   counts 3, anywhere else 1. A technology a requirement names counts 3.
2. **Words that mean the same** (`SAME`): migration and modernization; conflict, disagreement
   and dispute; mentoring and coaching; Node and Node.js; the earlier groups. "Legacy",
   "pushback", "rate" and "base" stay out, each with its reason. **One word in its forms**
   (`FORMS`): incident and incidents, API and APIs, idempotent and idempotency, and so on,
   because the engine does not stem. **Compounds** (`COMPOUNDS`): "event-driven" is one term,
   so "driven" alone no longer finds "schema-driven".
3. **How a question is put is not what it is about**: "experience", "background", "approach",
   "handle", "ever", "used", "know", "worked" are dropped with the other filler.
4. **Links made in code** (`links.ts`): a note or story is linked to an **employer it names**
   (the whole name, or its first word when the material only ever writes that word as a name);
   to an **achievement whose figure it states** with one of the achievement's own words beside
   it ("65% fewer vulnerabilities", never "60% implementation"); a requirement to the **person's
   technologies it names**, and, **through a note** that says one of the employer's technologies
   and names exactly one employer, to that employer (this is how NestJS finds Helcim).
5. **Linked first.** The evidence linked to whatever leads the stories, prep and requirements
   slots is ranked before evidence that merely shares a word. A line speaks for the question
   only when it matches on its heading or on two words (or on every word of a one-word
   question). A requirement that names several technologies is followed only for the ones the
   question names, when it names any. A requirement's technologies are followed only when no
   note or story names anything.
6. **Two roles.** The coach has 4 places for evidence (was 6 fragments) and an answer 6 (was
   16): the primary role first with up to 3 (4), then one backup role. The backup is left out
   when the primary matches at least twice as many words, or is linked while the backup was
   found on fewer than two words. The inspecting view is not arranged by role.
7. **A story's words search the person's own record only** (evidence and roles). Before, "the
   Larchmont Pay story" put the person's pay preference into a question about mentoring.

### What the engine would need

Everything was done in the product with what `resolve` offers; three things are approximations
the engine could make exact.

- **Preferred records per call.** A link is passed as `overrides.pinned`, the only way to rank a
  record first and keep it when it shares no word with the question. So a linked fact reports
  `score.pinned: true`, which says "a person's pin". Wanted: `overrides.preferred` (ids ranked
  after pins and before the rest, exempt from the relevance cut), or a preference by tier.
- **A cap per group in a slot.** "At most two roles, the primary leading" is done after the
  engine has ranked: the product asks for up to 60 and fills 4 places itself, then rewrites
  `selected`, `excluded`, the slot's resolution and the digest (`+arranged`). Wanted: a slot
  option such as `groupBy: "of.role", groups: 2, lead: 3`, so the digest covers the result.
- **A query per slot.** A story's words must reach evidence and roles and nothing else, so two
  `resolve` calls are merged by slot and both digests joined. Wanted: `queries: { slot: text }`.
- Smaller: stemming or a `forms` list (the 20 word-form groups exist only because there is
  none); a score for an excluded record; hyphenated compounds kept as one term.

### What is left, and what phase 2 should know

- The misses above need meaning, not words: a model's links (phase 5) or the `answers` labels
  of phase 3. A note that names no employer links nothing in code.
- The recipe is at version 2 and `candidate-evidence` is gone. The readers were lifted (the
  coach, the context route, their suites); the view contract and the Context pane name no
  kinds and needed no change.
- **A decision to record.** ADR-0041 has a chosen story widen the whole question; rule 7
  narrows that to the person's own record, and the coach is now given 4 whole achievements
  where it was given 6 fragments. Both want an ADR that amends ADR-0041.
- A stage's records should join the same rules: a stage's prep note links by the same code (its
  kind must be `prep-note`, or `links.ts` must be told the new kind), and a stage filter belongs
  before `arrange` in `pack.ts`, which assumes the slot named `evidence` holds achievements.
- `walkthrough-context-pack.md` describes recipe version 1 and is stale on records, scores and
  the worked selections.

## 11. Result of phase 2 (2026-10-10)

Stages are things: each has its people, notes, transcripts and outcome; an application has
dated "employer said" entries and research documents; all of it reaches the pack as sources with
a stage, with no model call. Phase 3 builds on the shapes below.

### The data model as built

One migration, `20261010051810_interview_brief_stages`. Nothing existing is moved or rewritten.

| Table | What | Columns added or held |
|---|---|---|
| `interview.interviews` (existing) | a stage | new, all nullable: `notes`, `outcome`, `next_steps` |
| `interview.interview_participants`, `interview.people` (existing, reused) | a stage's people | unchanged. A person met is a `people` row of the employer (`company_id`), tied to the stage by a participant row with a role. They fit: name, title and role are all there, and the same person met in two stages is one row |
| `interview.interview_transcripts` (new) | what was said in a stage | `owner_user_id`, `interview_id`, `title`, `origin` (`recorded`, `uploaded`, `pasted`), `origin_name`, `capture_policy` (`device-only`, `permitted-remote`), `occurred_at`, `content`, `content_sha256`, `chars`, `turns` |
| `interview.employer_said_entries` (new) | one thing the employer said | `owner_user_id`, `candidacy_id`, `said`, `said_by`, `channel` (`email`, `call`, `message`, `other`), `said_on` (null: no date), `content_sha256` |
| `interview.research_documents` (new) | one research document | `owner_user_id`, `company_id`, `candidacy_id` (null: the company's, read by every application to it), `title`, `origin` (`url`, `file`, `pasted`), `origin_ref`, `content`, `content_sha256`, `chars`, `updated_at` |

The three new tables are private to their owner: forced row-level security pins a row to its
tenant and its `owner_user_id`, and every reference to a tenant-owned row is composite on
`(tenant_id, id)`. A transcript and an application's research go when their stage or application
goes (cascade). The stage's own notes and outcome are columns of `interviews`, which is
tenant-scoped like `candidacies.notes` has always been; the routes settle ownership (the
application's candidate is the member) before anything is read.

Contracts are in `packages/interview-contracts/src/interview-brief.ts`
(`interviewBriefSchema`, the stage, transcript, employer-said and research request schemas,
`INTERVIEW_BRIEF_BOUNDS`, `mayLeaveDevice`). The repository is
`products/interview/src/backend/brief/repository.ts` (query builder only), the routes
`brief/routes.ts`, registered on the documents API behind its guard:

```
GET    /api/interview/documents/candidacies/:id/interview-brief
POST   …/stages            PATCH …/stages/:stageId     DELETE …/stages/:stageId
PUT    …/stages/order      POST  …/notes/move
POST   …/stages/:stageId/transcripts            (pasted text)
POST   …/stages/:stageId/transcripts/upload     (a file: .txt, .vtt, .srt)
GET    …/recordings        POST  …/stages/:stageId/transcripts/recordings
GET | PATCH | DELETE  …/stages/:stageId/transcripts/:transcriptId
POST   …/employer-said     PATCH | DELETE …/employer-said/:entryId
POST   …/research          POST  …/research/upload     POST …/research/keep-carried
GET | PATCH | DELETE  …/research/:documentId
```

A refusal is `{ error: { code } }` and nothing else: `not-found`, `invalid-request`,
`body-too-large`, `limit-reached`, `invalid-transcript`, `unsupported-format`, `stage-in-use`,
`loosening-refused`, `nothing-to-carry`. Another member, and another workspace, get `not-found`.

### Bounds chosen

| What | Bound |
|---|---|
| Stages per application; people per stage; transcripts per stage | 12; 12; 8 |
| Employer-said entries; research documents per application | 100; 40 |
| A stage's notes; outcome; what comes next | 20,000; 4,000; 2,000 characters |
| A transcript | 1,000,000 characters (about sixteen hours of speech); an upload of 4 MiB |
| An employer-said entry; a research document | 8,000; 200,000 characters (an upload of 1 MiB) |

A transcript is one bounded request, neither streamed nor chunked: the documents API already
reads a 5 MiB upload in one body, and a pasted transcript's JSON body is allowed twice the
bound's bytes for escaping. A file must be text in a format `readTranscript` parses, and
something must be said in it.

### What was carried over

| Old | Now | How |
|---|---|---|
| `candidacies.notes` | stays readable where it was; offered to the first stage (`offeredNotes`) while that stage has no notes | `POST …/notes/move` puts it on the first stage and empties the old field, in one transaction, when the person says so |
| `companies.research` | offered as one document, `carried-company-research` | `POST …/research/keep-carried` makes it a document of the company and empties the old field |
| The briefing form's `employerNotes` | one entry with no date (`briefingEmployerSaid`) | the form's field is the "Employer said" list; a save writes `employerSaid` and, beside it, the same entries as the text `employerNotes`, so every reader of the pack is unchanged |
| The briefing form's `research` | one document (`briefingResearchDocuments`) | the field is still one text on that form: its condensed copy is made from that text, and a briefing pack is not tied to an application, so it has no document store to move into |

The employer brief's clean-up now reads the application's notes and each stage's, so notes moved
onto a stage are still what its prep lines are distilled from. The session's snapshot gains the
stage's notes (its own and earlier stages'), the employer-said lines and up to 20,000 characters
of research; never a transcript.

### The surface

The Interview form is the modal the native panel opens from the start screen and the task bar
(`interview-context-modal.tsx`): it is where an application is made and its posting and notes are
kept, so the stages belong there. Under its fields, once the application is saved,
`InterviewBriefForm` (`frontend/studio/interview-brief/`) shows each stage as its own section
(people, when, minutes, format, status, notes, transcripts, outcome, what comes next), "Employer
said" and "Research". A stage is added, moved earlier or later, and removed after a confirmation
in the page. A transcript is pasted, uploaded, or attached from the Studio's own recordings (the
member's only: a recording is theirs when the session it names is). The documents picker and the
live start screen still only choose an application and a stage; they were not changed. Built from
the library's parts alone. Two parts did not do what their types say in the vendored build, and
the nearest part was used: `Empty` shows "No data" whatever its `title`, so an empty list is a
line of `Typography.Text`; `Alert` does not pass `data-testid` on, so it sits in a `Flex` that
carries it. The library has no reorder handle for a `Collapse`; the two buttons do it.

### Into the pack (what phase 3 can rely on)

`context-pack/brief-sources.ts`, from `readBriefMaterial` (the brief with its words, read in the
owner's scope). Every source carries `id`, `revision` (the first 16 characters of `sha256`),
`kind`, `sha256`, `chars`, `sendable`, and `stage` and `stageId` where it has one.

| Source id | Source kind | Record kind | Record id | Fields |
|---|---|---|---|---|
| `stage:<stageId>:notes` | `candidate-notes` | `prep-note` | `prep:<stageId>:<hash12>` | `section: "prepNotes"`, `stage`, `stageId`, `heading`, `carried` |
| `stage:<stageId>:outcome` | `stage-outcome` | `prep-note` | `outcome:<stageId>:<hash12>` | `section: "stageOutcome"`, `stage`, `stageId` |
| `stage:<stageId>:details` | `stage-details` | `employer-fact` | `stage-detail:<stageId>:<hash12>` | `section: "stageDetails"`, `stage`, `stageId` |
| `stage:<stageId>:transcript:<transcriptId>` | `transcript` (with `capturePolicy`) | `transcript-turn` | `turn:<transcriptId>:<n>` | `speaker`, `startMs`, `endMs`, `clock`, `turn`, `transcriptId`, `stage`, `stageId`, `deviceOnly` |
| `employer-said:<entryId>` | `employer-said` | `employer-fact` | `said:<entryId>:<hash12>` | `section: "employerSaid"`, `saidBy`, `channel`, `saidOn`, `said` |
| `research:<documentId>` | `research` | `employer-fact` | `research:<documentId>:<hash12>` | `section: "research"`, `title`, `scope`, `origin`, `originRef` |

- Text is cut by line; a line over 360 characters at its sentences (a slot leaves out a record
  over 400). A record's `locator` is `/stages/<stageId>/notes/<line>`, `/employerSaid/<id>/<line>`,
  `/research/<id>/<line>`; a turn's is its clock span, `10:39:54-10:40:09`.
- A turn is consecutive fragments of one speaker. `transcript-turn` is declared in the recipe and
  in no slot, so it is prepared, counted and inspectable and never offered as a fact.
- `sourceMayLeaveDevice(source)` and `remoteSources(sources)` say what a remote model may be
  given; a device-only transcript's turns say `deviceOnly: true`.
- `stage` on a record is the stage's place (1 first). `scopeToStage(sources, n)` leaves a later
  stage's records out and returns them; `withStageBrief(base, brief, n)` scopes, then links
  (a stage's note is linked by `links.ts` exactly as the brief's are); `prepareStagePack` does
  both for a session. Of two records that match a question equally the stage's own leads, an
  earlier stage's follows, the application's comes after; a record that bears on the question
  more still comes first.
- The view (`GET sessions/:id/context`) takes `stage=<n>` or `stage=all`; absent, the stage the
  session was started for. It answers with `stage`, `stages`, each fact's `stage`, each source's
  `kind`, `stage`, `records` and `sendable`, and a later stage's records under reason `scope`.
  The window's Context pane has the picker.
- Notes offered from the application (not yet moved) are left out of the pack while the employer
  brief has prep lines, which are those notes distilled: the same note is not given twice.

### Measured

`pnpm pack:bench --stages` on the fixture, extended with `stages.json` (two stages with people
and notes, a synthetic device-only transcript, three employer-said entries, three research
documents) and `gold-stages.json`:

| Measure | Result |
|---|---|
| Stages with material of their own | 2 of 2 (0 of 2 before) |
| Right stage note first | 5 of 5 |
| An earlier stage's line follows | 1 of 1 |
| A later stage's line left out | 2 of 2 |
| The employer's line offered | 2 of 2 |
| The first benchmark, with the stage material present | 24/28 evidence, 23/27 prep, 2 wrong-employer: unchanged |

`pnpm pack:bench` itself is unchanged (24/28, 23/27, 2/28). One thing was learned from it: the
first version put every record of the stage ahead of the application's in a slot, whatever it
matched, and cost the first benchmark six prep notes (17/27). The rule is now relevance first and
the stage as the tie-break. A tie still goes to the stage: a stage line that shares one word with
a question wins over an application line found by one word.

### What is left

- No model reads any of this yet (phases 3 and 4): research and employer-said are offered as
  their own lines, not as extracted facts, and a transcript's turns are raw.
- The "request" per stage (section 3) is not stored.
- A recording file's name carries only the first eight characters of its session's id; a
  recording is offered to the member whose session matches them. Writing the owner into the
  recording would settle it exactly.
- Research uploads are plain text and Markdown only. A PDF or a Word file is refused.
- Removing a stage a live session or a document was made for is refused (`stage-in-use`).
- The Briefings form's research is still one text (see the carry-over table).
- The real window was not seen: the form and the picker are proven by their suites, not by eye.
