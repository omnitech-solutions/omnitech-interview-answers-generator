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
