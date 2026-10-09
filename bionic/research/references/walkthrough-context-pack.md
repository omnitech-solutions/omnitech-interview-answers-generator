---
title: "The context pack, from an experience matrix to the facts a note may cite"
slug: walkthrough-context-pack
type: references
tags: [context-pack, engine, walkthrough, grounding]
sources: []
last_reviewed: 2026-10-09
---

# The context pack, from an experience matrix to the facts a note may cite

Description of: as of 2026-10-09, uncommitted work on master (HEAD `0748ea7`). Records, hashes, scores, digests and the view below were produced by running copies of `recipe.ts`, `sources.ts`, the pack's selection logic and the engine's `resolve.ts` on synthetic material (the shape of `context-pack/fixture.ts`, with the person renamed Jordan Vale and one proof point added: the migration). Decisions: [[adrs/ADR-0038-prepare-raw-information-into-attributable-context]], [[adrs/ADR-0041-the-first-context-pack-slice-derives-identities-fr]].

## At a glance

```
 matrix + employer brief + preferences        (loadSessionContext, owner's scope)
        │ sessionSources()
        ▼
 engine.context.prepare  ── no model for structured sources ──►  records (id, kind, text, fields, source.locator, hash)
        │
        ▼ per question: keyTerms(spoken)
 engine.context.resolve (projection coach|answer|inspect) ──► selected / excluded(reason) / resolutions / digest
        ├─► coach.ts: facts → prompt "THE CANDIDATE'S RECORD" ──► reply.ts checks [pointer] → grounding "verified"
        └─► GET …/sessions/:id/context → view JSON → window "Selected for this question"
```

The same selection feeds the coach and the window, so what the model read and what the person is shown cannot differ ([[research/references/walkthrough-live-coach]] shows the coach side).

## Scenario

Jordan Vale (synthetic) is asked "Tell me about a time you led a migration." The material: a matrix with roles Harbourline, Quayside Freight, Tidewater Labs and one story for "conflict with a stakeholder"; a Larkspur Analytics brief; three preference lines. 33 records result.

## Step 1: records as prepared

`matrixSource`, `briefSource` and `preferencesSource` (`sources.ts`) give each record an identity from its content, not its position (ADR-0041): a role is `role:<company>:<title>`, a fact `<role id>:<section>:<first 12 hex of sha256 of its text>`. The position stays as `source.locator`, the pointer the windows open. Three of the 33:

```json
{"id":"role:harbourline:staff-engineer","kind":"candidate-role","text":"Staff Engineer, Harbourline (2022 to 2025)",
 "fields":{"company":"Harbourline","title":"Staff Engineer","technologies":["Go","PostgreSQL","Kafka"],"tags":["platform"],"period":"2022 to 2025"},
 "priority":10,"source":{"id":"matrix:profile-1","revision":"3","locator":"/roles/0"},"hash":"0b234f5ed3080ce0"}
{"id":"role:harbourline:staff-engineer:proof_points:4a3c51fbda55","kind":"candidate-evidence",
 "text":"Led the migration of the berth scheduler from a Rails monolith to a Go service with no downtime",
 "fields":{"company":"Harbourline","title":"Staff Engineer","technologies":["Go","PostgreSQL","Kafka"],"tags":["platform"],"section":"proof_points"},
 "priority":3,"source":{"id":"matrix:profile-1","revision":"3","locator":"/roles/0/proof_points/2"},"hash":"2748999bbb25e5ce"}
{"id":"story:5a8e65f974b4","kind":"candidate-story","text":"For \"conflict with a stakeholder\": The Quayside Freight invoice dispute with the finance director (or: The pilots' rota disagreement)",
 "fields":{"need":"conflict with a stakeholder"},"priority":2,"source":{"id":"matrix:profile-1","revision":"3","locator":"/story_selector/0"},"hash":"0a2994a766f3f8ad"}
```

Priority: newest role 10 (then 9, 8), proof points and metrics 3, leadership signals 2, responsibilities 1, story 2. The `hash` is the engine's `digest(canonical([kind, text, fields]))`. Employer lines have no locator, so their pointer is their id (`brief:mustHaves:…`); preference lines get `/context/candidatePreferences/<n>`.

## Step 2: `engine.context.prepare`

Called from `prepareContextPack` (`pack.ts`) with `{ sources, recipe: INTERVIEW_CONTEXT_RECIPE }` and the execution `{ scope: { tenantId, actorId, productId: "omnitech.interview" }, permissions: ["interview.read"], signal, for: { kind: "session", id } }`.

```ts
sources = [
  { id: "matrix:profile-1",     revision: "3",                kind: "experience-matrix",     records: [ …24 ] },
  { id: "brief:candidacy-1",    revision: "9d64e09a6b758f32", kind: "employer-brief",        records: [ …6 ] },  // revision = sha256 of the brief JSON, first 16 hex
  { id: "preferences:draft",    revision: "2",                kind: "candidate-preferences", records: [ …4 ] } ]
```

No model is called (the sources are structured). It returns `{ ok: true, prepared: { recipe: {id:"interview-context",version:"1"}, sources, records: [33], rejected: [] } }`. A record kind the recipe lacks, or a repeated id, returns `ok: false` and `ContextPackError` is thrown: nothing is dropped silently. Material is re-prepared at most once a minute by the coach (`HELD_MS`), and on every request to the context route. The prepared result is not stored; that, and extraction from raw text, are not built.

## Step 3: `engine.context.resolve`

The question is cut to key terms (`keyTerms`: lowercase, filler dropped): "led migration". Input and result:

```ts
engine.context.resolve({ prepared, recipe, projection: "coach", query: "led migration" })  // no budget is passed
// → { ok: true, resolved: { selected, excluded, resolutions, meta } }
```

Aliases make "led" match "lead" and "migration" match "migrate". Selected (slot, score words/priority, pointer):

| Slot | Pointer | Score | Text |
|---|---|---|---|
| `candidate.name` / `headline` / `location` | `/candidate` | exact | Jordan Vale / Platform engineer / Lisbon |
| `employer.company` / `role` | `/context/employerBrief` | exact | Larkspur Analytics / Principal Engineer |
| `evidence` | `/roles/0/proof_points/2` | 2 / 3 | Led the migration of the berth scheduler … |
| `evidence` | `/roles/0/leadership_signals/0` | 1 / 2 | Mentored four engineers through the ledger rewrite |
| `requirements` | `brief:responsibilities:63b5c86bda7b` | 1 / 1 | Lead the forecasting pipeline rebuild |

Excluded: 28 records, all `relevance` (no query word found), including the story, the three roles, all preferences and the other proof points. Resolutions: `stories`, `roles`, `preferences`, `employer`, `prep` are `no-such-fact`; `evidence` and `requirements` `covered`; the five exact slots `covered`. Digest `bd82de8aeab0d4f9`. Other reasons exist: `excluded` (a person's override), `over-limit` (text over 400 characters), `limit`, `budget` (not reachable today, since no budget is passed).

Ranking: pin, preferred, matched words (a word in `technologies` or `company` counts 3, `tags` 2, text 1), priority, id.

## Step 4: the view the route returns

`GET /api/interview/t/<tenant>/sessions/<id>/context?projection=coach&q=<question>` (`routes.ts`; defaults to `inspect`; owner-only; reads the owner's scope, writes nothing) returns `{ "view": … }` (`contextViewSchema`), shortened:

```json
{ "view": { "projection": "coach", "spoken": "Tell me about a time you led a migration.", "terms": "led migration", "records": 33,
  "selected": [ { "id": "role:harbourline:staff-engineer:proof_points:4a3c51fbda55", "pointer": "/roles/0/proof_points/2",
                  "text": "Led the migration of the berth scheduler …", "kind": "candidate-evidence", "about": "candidate", "slot": "evidence", "exact": false } ],
  "excluded": [ { "id": "story:5a8e65f974b4", "pointer": "/story_selector/0", "text": "For \"conflict with a stakeholder\": …",
                  "kind": "candidate-story", "about": "candidate", "slot": "stories", "reason": "relevance" } ],
  "slots": [ { "slot": "evidence", "state": "covered", "count": 2 }, { "slot": "roles", "state": "no-such-fact", "count": 0 } ],
  "digest": "bd82de8aeab0d4f9",
  "sources": [ { "id": "matrix:profile-1", "revision": "3" }, { "id": "brief:candidacy-1", "revision": "9d64e09a6b758f32" }, { "id": "preferences:draft", "revision": "2" } ] } }
```

Reach it in the window: Live session, the coach layout, right column, "Context" tab, the "Read as" menu, last entry "Selected for this question". `context-pane.tsx` reads it for the question on show (projection `coach`) and draws, per slot in selection order: a label ("Your evidence", "What they require", …), each fact with a tag (Yours / Theirs / Your preference) and its pointer, then "8 of 33 facts given. Left out: 28 not about this question." A failed read says the selection could not be read.

## Step 5: from selection to the coach's prompt and the verified mark

`createCoachContext` (`coach/context.ts`) takes `pack.facts("coach", asked)` and prefixes an exact field with its label. `coachPrompt` prints candidate and preference facts under `THE CANDIDATE'S RECORD (cite a fact by its [pointer])` as `[<pointer>] <text>`, employer facts under `EMPLOYER MATERIAL (not the candidate's experience)`. `known` (pointer to text) holds candidate and preference facts only. `reply.ts` then checks each bold claim. Results from running it with the pointers above:

| Model wrote | Result |
|---|---|
| `**led the migration**[/roles/0/proof_points/2]` | `grounding: "verified"`, `source: "/roles/0/proof_points/2"` |
| `**no downtime**` (uncited) | verified: one fact contains all its words |
| `**mentored 6 engineers**[/roles/0/leadership_signals/0]` | `inferred`: the figure 6 is not in the fact |
| `**cut latency 40%**[/roles/0/proof_points/0]` | `inferred`: that pointer was not selected for this question |

A preference fact (`/context/candidatePreferences/0`) can verify a claim, an employer fact never can (ADR-0041 choice 4); this was read in the code, not run here. Only three `SAY` lines are kept in a conversation note.

## Scenario: a chosen story widens the question

"Tell me about a conflict with a stakeholder." matches the story (slot `stories`). Because a story was selected, `pack.resolve` selects again with the story's words added: terms become `conflict stakeholder conflict stakeholder quayside freight invoice dispute finance director pilots rota disagreement` and the Quayside role (`/roles/1`, score 6) and its evidence (scores 7, 6, 6) are found, which the question alone would not find. Digest `856023a8aebde273`.

## Scenario: nothing matches, recent roles

"Tell me about yourself." has terms `yourself`: no fact matches. `resolve` offers the recent roles (`/roles/0`, `/roles/1`, `/roles/2`, by recency alone, score words 0) in the `roles` slot, marks `roles` covered, and the digest ends `+recent-roles`: `c088e97a9233b1a5+recent-roles`.

## The projections

| Projection | Evidence | Other slots (preferences, requirements, employer, prep) | Stories | Roles | Used by |
|---|---|---|---|---|---|
| `coach` | 6 | 3 each | 2 | 3 | the live coach; the window's selected view |
| `answer` | 16 | 6 each | 2 | 3 | defined; no reader is wired yet (not determined) |
| `inspect` | 60 | 24 each | 2 | 3 | the route's default |

All three also look up the five exact fields. Each ranked slot caps text at 400 characters; `requirements`, `employer` also hold a 0.15 budget share (inert without a budget). Jordan's small material fits every projection, so all three select the same 8 facts for the migration question.

## What is kept

The pack is held in the coach process for a minute and rebuilt per request in the route; nothing is stored. The engine records the `prepare` call as a step when a trace store is configured (kind and row shape: not determined).

## Try it

```bash
pnpm exec vitest run products/interview/src/backend/context-pack   # the suites use fixture.ts and a real engine with no model
```

In the window: start a live session with a pinned profile and a linked brief, open Context, choose "Selected for this question", and change the question on show.

## Limits and decisions

ADR-0041's four choices: identity derived from content; a chosen story widens the question; the recent roles when nothing matches; preferences verify as the person's own. Not built (from [[briefs/BRIEF-context-pack-next]]): extraction from raw postings and notes (needs a place to keep prepared results; open owner decision), stored identity, the answers, briefing and documents readers, coverage, citation and pivot views, pins and exclusions, budgets from runtime capacity. The pane's drawing was verified by component tests only.
