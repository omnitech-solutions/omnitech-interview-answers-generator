---
title: "The context pack on a real application: Zensurance, Tech Lead, Core / Payments"
slug: context-pack-worked-example-zensurance
type: references
tags: [context-pack, interview-brief, worked-example, baseline]
sources: []
last_reviewed: 2026-10-10
---

# The context pack on a real application: Zensurance, Tech Lead, Core / Payments

Description of: master at `24e598f`, 2026-10-10. Every record, selection and number under
"Today" was produced by running the repository's own `matrixSource`, `briefSource` and
`prepareContextPack` on the owner's real material, read from the development database and the
local experience matrix. Everything under "End state" is a design and is marked so. The
interviewer's name is replaced by "[the hiring manager]"; nothing else is changed. `…` marks
repeated entries of the same shape that were left out.

Read with [[briefs/BRIEF-interview-brief-and-context-pack]] (what to build and in what order)
and [[research/references/walkthrough-context-pack]] (the mechanism on synthetic data).

## 1. The inputs, as they are stored today

### 1.1 The experience matrix (`my-experience-matrix.json`, 50 KB, 15 roles)

Read by `localMatrixPath`, kept in the database as a profile revision with its SHA-256.

```json
{
  "candidate": {
    "name": "Desmond O’Leary",
    "headline": "Staff-level systems architect focused on workflow-heavy, integration-heavy, and data-intensive platforms",
    "location": "Calgary, AB",
    "profile_tags": ["staff-engineer", "architect", "full-stack", "…"]
  },
  "resume_variants": [
    { "id": "base-short", "label": "Base Short Resume", "best_for": ["general staff engineer roles", "…"] },
    "…"
  ],
  "contracting_companies": [
    { "company": "Omni-Tech Solutions", "title": "Lead Full Stack Developer / Architect / Contractor",
      "period": "July 2020 – September 2024", "from": "July 2020", "to": "September 2024",
      "description": "The candidate's own consultancy. …",
      "clients": ["MajorClarity by PAPER", "Spacelist", "Geoforce", "Kickbooster", "Relay Platform"] }
  ],
  "roles": [
    {
      "company": "Helcim",
      "title": "Senior Software Developer / Architect",
      "period": "2024–Present",
      "industry": ["fintech", "payments", "platform engineering"],
      "system_types": ["payments platform", "legacy modernization", "…"],
      "problem_spaces": ["technical transformation", "developer velocity", "…"],
      "technologies": ["Laravel", "PHP 8.x", "Vue.js", "Vue-Query", "Node.js", "OpenAPI", "MySQL", "AWS", "Golang"],
      "patterns": ["contract-first architecture", "schema-driven generation", "…"],
      "responsibilities": ["Led modernization of legacy PHP monolith", "…"],
      "metrics": [
        { "label": "scaffolding reduction", "value": "80%", "direction": "decrease" },
        { "label": "security incidents", "value": "40%", "direction": "decrease" },
        { "label": "release cycles", "value": "weeks to hours", "direction": "decrease" }
      ],
      "leadership_signals": ["architecture ownership", "guild participation", "mentorship", "…"],
      "proof_points": ["Reduced release cycles from weeks to hours", "…"],
      "tags": ["fintech", "payments", "contract-first", "…"]
    },
    { "company": "MajorClarity by PAPER", "title": "Lead Software Developer / Architect", "period": "2023",
      "engaged_through": "Omni-Tech Solutions", "…": "same shape" },
    "… 13 more roles of the same shape"
  ],
  "industry_mappings":   [ { "industry": "…", "best_fit_roles": ["…"] }, "…" ],
  "technology_mappings": [ { "technology": "…", "roles": ["…"] }, "…" ],
  "leadership_signals":  [ { "signal": "…", "evidence": ["…"] }, "…" ],
  "story_selector":      [ { "need": "fintech modernization", "primary_story": "Helcim", "backup_story": "Morgan Stanley / Solium" }, "… 7 more" ],
  "tag_taxonomy": { "…": ["…"] },
  "repositories_of_note": [ "…" ],
  "experience_matrix_extensions": { "…": "…" }
}
```

### 1.2 The application (`interview.candidacies` + `interview.companies`)

What the person typed on the Interview form, one row.

```json
{
  "company": "Zensurance",                       // companies.name
  "title": "Tech Lead, Core / Payments",          // candidacies.title          (form: Role)
  "posting_url": null,
  "job_description": "About the job\nAbout Us:\nZensurance is redefining commercial insurance for Canadian businesses. … (12,369 characters, pasted whole)",
  "notes": "Round: [the hiring manager], Manager Engineering; Thu Oct 8, 11:30-12:30 MT; leadership and experience deep dive, not coding. …\nTell me about yourself: 20+ years; …\n… (5,879 characters: 16 lines, one per expected question)",
  "research": null,                               // companies.research  (empty today)
  "company_notes": null                           // companies.notes     (empty today)
}
```

### 1.3 The stages (`interview.interviews`, two rows for this application)

```json
[
  { "ordinal": 1, "kind": "hiring_manager", "label": "Hiring manager", "scheduled_at": null, "duration_minutes": null, "format": null, "status": "scheduled" },
  { "ordinal": 2, "kind": "technical",      "label": "Technical",      "scheduled_at": null, "duration_minutes": null, "format": null, "status": "scheduled" }
]
```

`interview.interview_participants` (who is in a stage, with a role label) exists and is empty for
both. **A stage holds no notes, no transcript and no outcome today**: the date, the interviewer
and what she judges live as free text inside the application's `notes` and inside the brief.

### 1.4 The briefing form (`briefingContextSchema`, what the Briefings page edits)

```ts
{
  company: string, role: string,
  stage: "recruiter" | "hiring-manager" | "leadership" | "behavioural",   // one stage, not a list
  request?: string,            // what the person wants from this preparation
  interviewer?: string, interviewerTitle?: string, durationMinutes?: number,
  jobDescription?: string,
  employerNotes?: string,      // what the employer or recruiter TOLD you (an email, a call): their words
  research?: string,           // what you FOUND OUT yourself: interviewer background, candidate reports
  condensed?: { jobDescription?: string, research?: string }   // a model-shortened copy, dropped when its original changes
}
```

"Employer notes" reads strangely because it sits beside "notes" on the application, which are
the candidate's own prep. The useful distinction is who said it: the employer (their emails,
the recruiter's description of the process), the candidate (prep), or a third party (research).
The end state names them that way.

### 1.5 The employer brief (`candidacies.employer_brief`, 8.2 KB): the one AI-derived input today

`POST …/candidacies/:id/brief` gives a model the job description and the notes and gets back
this schema-constrained object (`employerBriefSchema`). It is stored with a hash of its inputs.

```json
{
  "company": "Zensurance",
  "role": "Tech Lead, Core / Payments",
  "summary": "Tech Lead for the Core or Payments team, steering technical direction with a focus on security and scalability. …",
  "team": "Core owns quoting and pricing, renewals, document generation, policy data and business rules. Payments owns checkout. …",
  "interviewFormat": "Hiring-manager interview with [the hiring manager] (Manager, Engineering), Thu Oct 8 2026, 11:30-12:30 Mountain: leadership and experience deep dive, not coding. Next: live technical / coding assessment. No AI assistants during live interviews; an AI scribe takes notes.",
  "companyFacts":     ["Redefining commercial insurance for Canadian businesses as a digital-first InsurTech", "Deloitte Technology Fast 50: 2023, 2024, 2025", "… 7 more"],
  "values":           ["DELIVER: set ambitious goals and achieve them", "… 4 more"],
  "mustHaves":        ["7+ years building complex scalable APIs, including third-party API integration", "… 11 more"],
  "niceToHaves":      ["… 3"],
  "techStack":        ["Node", "React", "Redux", "TypeScript", "JavaScript", "PostgreSQL", "… 8 more"],
  "responsibilities": ["Manage third-party integrations for reliability, performance and security", "… 11 more"],
  "prepNotes":        ["Tell me about yourself: 20+ years; integration- and workflow-heavy platforms; …", "… 15 more"],
  "questionsToAsk":   ["Which part of Core would this Tech Lead own first: quoting and pricing, renewals, documents, or policy and business rules?", "… 7 more"]
}
```

Where each part came from: `companyFacts`, `values`, `mustHaves`, `niceToHaves`, `techStack`,
`responsibilities`, `team`, `summary` from the job description; `prepNotes`, `questionsToAsk`
and `interviewFormat` from the candidate's notes. **Nothing in the object says which**, and no
line points back at the sentence it was drawn from.

## 2. Today: how those inputs become a pack

No model is called here. `sessionSources` turns the matrix and the brief into records;
`engine.context.prepare` checks them against the recipe.

| Source | Records | Of which |
|---|---:|---|
| `matrix:local-experience-matrix` | 196 | 1 profile, 15 roles, 172 evidence, 8 stories |
| `brief:zensurance` | 83 | 1 employer detail, 41 requirements, 17 employer facts, 24 prep notes |
| preferences | 0 | none typed |
| **Total** | **279** | |

Real records, one of each main kind:

```json
{ "id": "candidate", "kind": "candidate-profile",
  "text": "Desmond O’Leary: Staff-level systems architect focused on workflow-heavy, integration-heavy, and data-intensive platforms",
  "fields": { "name": "Desmond O’Leary", "headline": "Staff-level systems architect …", "location": "Calgary, AB" },
  "locator": "/candidate" }

{ "id": "role:helcim:senior-software-developer-architect", "kind": "candidate-role",
  "text": "Senior Software Developer / Architect, Helcim (2024–Present)",
  "fields": { "company": "Helcim", "title": "Senior Software Developer / Architect",
              "technologies": ["Laravel", "PHP 8.x", "Vue.js", "…"], "tags": ["fintech", "payments", "…"], "period": "2024–Present" },
  "locator": "/roles/0" }

{ "id": "role:helcim:senior-software-developer-architect:proof_points:36d44c99e7e5", "kind": "candidate-evidence",
  "text": "Reduced release cycles from weeks to hours",
  "fields": { "company": "Helcim", "title": "…", "technologies": ["…"], "tags": ["…"], "section": "proof_points" },
  "locator": "/roles/0/proof_points/0" }

{ "id": "story:0303d37a83d3", "kind": "candidate-story",
  "text": "For \"importers / onboarding / ops\": Spacelist (or: MajorClarity by PAPER)",
  "fields": { "need": "importers / onboarding / ops" }, "locator": "/story_selector/3" }

{ "id": "brief:mustHaves:1cc62d4de2a2", "kind": "employer-requirement",
  "text": "7+ years building complex scalable APIs, including third-party API integration",
  "fields": { "section": "mustHaves", "label": "must have requirements required" }, "priority": 3 }

{ "id": "brief:prepNotes:08429e2d925f", "kind": "prep-note",
  "text": "Third-party integrations, carrier APIs: the external API is not our domain model; adapter boundary, deadlines, bounded retries, idempotency keys, circuit breaking, reconciliation, per-partner latency and failure metrics.",
  "fields": { "section": "prepNotes", "label": "prep notes" }, "priority": 3 }
```

The pack is held in memory for a minute and rebuilt on demand. Nothing is stored.

## 3. Today: what the model is given for a question

`pack.resolve("coach", spoken)` cuts the question to key terms, and the engine picks records
slot by slot by counting matching words (a word in `technologies` or `company` counts 3, in
`tags` 2, in the text 1; a small alias table makes "led" match "lead"). The view for one
question, shortened:

```json
{ "projection": "coach", "spoken": "How do you approach third-party carrier API integrations?",
  "terms": "approach third party carrier api integrations", "records": 279,
  "slots": [ { "slot": "candidate.name", "state": "covered", "count": 1 }, "… 4 exact slots",
             { "slot": "stories", "state": "no-such-fact", "count": 0 }, { "slot": "evidence", "state": "covered", "count": 6 },
             { "slot": "roles", "state": "covered", "count": 3 }, { "slot": "preferences", "state": "no-such-fact", "count": 0 },
             { "slot": "requirements", "state": "covered", "count": 2 }, { "slot": "employer", "state": "covered", "count": 1 },
             { "slot": "prep", "state": "covered", "count": 3 } ],
  "selected": [ { "id": "role:relay-platform:…:metrics:b1517cd9f307", "pointer": "/roles/5/metrics/2",
                  "text": "front-end code: 35% (decrease)", "kind": "candidate-evidence", "about": "candidate", "slot": "evidence", "exact": false }, "… 19 more" ],
  "excluded": [ { "id": "story:0303d37a83d3", "pointer": "/story_selector/3", "text": "For \"importers / onboarding / ops\": …",
                  "kind": "candidate-story", "about": "candidate", "slot": "stories", "reason": "relevance" }, "… 258 more" ],
  "digest": "fa3f5d4d3c43c01e",
  "sources": [ { "id": "matrix:local-experience-matrix", "revision": "2" }, { "id": "brief:zensurance", "revision": "baseline" } ] }
```

The coach's prompt then lists the selected candidate facts under "THE CANDIDATE'S RECORD (cite
a fact by its [pointer])" as `[/roles/5/metrics/2] front-end code: 35% (decrease)`, and the
employer's and prep lines under their own headings. **The model retrieves nothing itself.**
Code decides what it reads, and code checks what it cites: a claim is marked verified only if
its words and figures are in a fact that was selected.

## 4. The baseline: ten questions on the real material (coach projection)

| # | Question | Evidence chosen (first) | Right? | Prep note chosen (first) | Right? | Chars |
|---|---|---|---|---|---|---:|
| 1 | Tell me about yourself. | none | no | "Tell me about yourself: 20+ years; …" | yes | 398 |
| 2 | Why Zensurance? | none | no | "Why Zensurance: direct domain fit …" | yes | 392 |
| 3 | Tell me about a time you led a migration. | Shaw Communications, 2008: "high-profile side projects" | **no** (should be Helcim or MajorClarity) | "Round: …", then DORA, then observability | **no** (the modernization and MongoDB notes were missed) | 2,056 |
| 4 | How do you approach third-party carrier API integrations? | Relay Platform metrics and adapter proof points | yes | "Third-party integrations, carrier APIs: …" | yes | 1,537 |
| 5 | How would you move a service from MongoDB to PostgreSQL? | Cisco Systems: "API usage: 1M+ weekly hits" | **no** (the note itself names MajorClarity as proof) | "MongoDB to PostgreSQL, data consistency: …" | yes | 1,273 |
| 6 | What is your experience with NestJS? | PeopleWell: "story mapping", "backlog refinement" | **no** | "Round: …", then "Why Zensurance" | **no** (a note headed "NestJS:" exists and was not chosen) | 1,835 |
| 7 | How do you use DORA metrics with a team? | Hubstaff and Kickbooster delivery points | **no** | "DORA, mentoring, disagreement: …" | yes | 1,661 |
| 8 | What are your salary expectations? | none; falls back to the three most recent roles | no | none | no | 346 |
| 9 | Tell me about a conflict with a stakeholder. | none; falls back to recent roles | no | none | no | 346 |
| 10 | What would your first 90 days look like? | Helcim metrics | partly | "First 90 days and AI: …" | yes | 1,538 |

**Baseline score: the right prep note leads on 6 of 10 questions; the right evidence leads on 1
of 10, and partly on 1 more.** The `answer` projection selects more (up to 40 facts, 3,000
characters) with the same ordering faults.

Why, in order of damage:

1. **Evidence is in fragments.** 172 records such as "story mapping" or "front-end code: 35%
   (decrease)" each stand alone, without the achievement they belong to. A fragment that
   happens to share a word wins.
2. **Matching is by shared words only.** "Migration" finds a 2008 mainframe migration and not
   "modernization" at Helcim; "NestJS" finds nothing in the matrix because the matrix says
   "Node.js", although the candidate's own note ties NestJS to Helcim.
3. **Nothing links a requirement, a prep note and the evidence that proves it.** The note for
   question 5 says "Proof: MajorClarity", and the pack still offers Cisco.
4. **A stage is not a thing.** The hiring-manager round's interviewer, date and focus are a
   sentence inside free text; the technical round has no material at all; nothing can be added
   per stage, and nothing from one stage (what was asked, what was said) reaches the next.
5. **No research, no transcript, no preferences** are in the pack: the first two have nowhere
   to live per stage, the third was never typed (questions 8 and 9 find nothing).
6. **Provenance stops at the brief.** An employer line cannot be traced to the sentence of the
   job description it came from, so it cannot be checked.
7. **The pack is rebuilt every minute and never kept**, so nothing can be reviewed, corrected
   or improved by the person.

## 5. End state (design): what a finished pack consists of

A pack is everything the assistant may know for **one application across all its stages**,
prepared once per change, reviewable by the person, and read by every feature through a named
projection. It is made of typed records. Every record that a model wrote carries the exact
quote it was drawn from and where; code confirms the quote is really there before the record
is kept.

```json
{
  "pack": { "id": "pack:zensurance:tech-lead-core-payments", "recipe": { "id": "interview-context", "version": "2" },
            "preparedAt": "2026-10-10T16:02:11Z", "digest": "9c41…",
            "sources": [
              { "id": "matrix:local-experience-matrix", "revision": "2", "kind": "experience-matrix", "sha256": "…" },
              { "id": "application:293c11a2", "revision": "7", "kind": "application", "sha256": "…" },
              { "id": "posting:293c11a2", "revision": "1", "kind": "job-description", "sha256": "…", "chars": 12369 },
              { "id": "research:zensurance/company-overview.md", "revision": "1", "kind": "research", "sha256": "…" },
              { "id": "stage:1:notes", "revision": "3", "kind": "candidate-notes", "stage": 1, "sha256": "…" },
              { "id": "stage:1:transcript:2026-10-08", "revision": "1", "kind": "transcript", "stage": 1, "sha256": "…", "chars": 61240 },
              { "id": "employer-said:recruiter-email-2026-10-02", "revision": "1", "kind": "employer-said", "sha256": "…" },
              "…" ] },

  "stages": [
    { "ordinal": 1, "kind": "hiring_manager", "label": "Hiring manager", "status": "done",
      "when": "2026-10-08T11:30-06:00", "minutes": 60, "format": "video, conversational, no coding",
      "people": [ { "name": "[the hiring manager]", "title": "Manager, Engineering", "judges": ["technical judgment", "hands-on credibility", "leadership", "delivery judgment", "operational ownership"] } ] },
    { "ordinal": 2, "kind": "technical", "label": "Technical", "status": "scheduled",
      "when": "2026-10-16T11:00-06:00", "minutes": 120, "format": "1 h live coding on a shared NestJS + React repository, 1 h system design; AI use allowed and to be transparent",
      "people": [ "… up to 5 panelists" ] }
  ],

  "records": [
    // ── candidate, from the matrix, composed in CODE (no model) ─────────────────────────────
    { "id": "achievement:helcim:release-cycles", "kind": "candidate-achievement",
      "text": "At Helcim (2024–Present, Senior Software Developer / Architect) led modernization of a legacy PHP monolith toward Laravel services and Vue.js micro-frontends; release cycles went from weeks to hours.",
      "fields": { "company": "Helcim", "period": "2024–Present", "technologies": ["Laravel", "PHP 8.x", "Vue.js", "Node.js", "OpenAPI"],
                  "metrics": [ { "label": "release cycles", "value": "weeks to hours" } ],
                  "themes": ["modernization", "migration", "legacy", "monolith"] },
      "source": { "id": "matrix:local-experience-matrix", "revision": "2",
                  "locators": ["/roles/0/responsibilities/0", "/roles/0/proof_points/0", "/roles/0/metrics/2"] },
      "by": "code" },
    "… one achievement per proof point or metric, each a whole sentence with its role",

    // ── employer, EXTRACTED by a model from the posting, each with its quote ────────────────
    { "id": "requirement:third-party-apis", "kind": "employer-requirement",
      "text": "7+ years building complex scalable APIs, including third-party API integration",
      "fields": { "level": "must", "themes": ["apis", "integrations"] },
      "source": { "id": "posting:293c11a2", "revision": "1", "locator": "chars 4120-4205",
                  "quote": "7+ years of experience building complex, scalable APIs including integrating with third-party APIs" },
      "by": "model", "verified": "quote-found" },
    "… 40 more requirements",

    // ── what the candidate prepared, per STAGE ──────────────────────────────────────────────
    { "id": "prep:1:mongodb-to-postgresql", "kind": "prep-note", "stage": 1,
      "text": "MongoDB to PostgreSQL: move only for a real problem (integrity, transactions); by bounded context; backfill, parity checks, shadow reads; one writer; reversible cutover.",
      "fields": { "answers": ["How would you move from MongoDB to PostgreSQL?", "How do you keep data consistent during a migration?"],
                  "proof": ["achievement:majorclarity:rostering-sync"] },
      "source": { "id": "stage:1:notes", "revision": "3", "locator": "line 9", "quote": "MongoDB to PostgreSQL, data consistency: move only for a real problem …" },
      "by": "model", "verified": "quote-found" },

    // ── what was learned IN a stage, extracted from its transcript ──────────────────────────
    { "id": "asked:1:service-or-monolith", "kind": "stage-question", "stage": 1,
      "text": "How do you decide when a feature should be a microservice or stay in the existing monolith?",
      "fields": { "askedBy": "[the hiring manager]", "followUps": ["What about business boundaries or data ownership?"] },
      "source": { "id": "stage:1:transcript:2026-10-08", "revision": "1", "locator": "10:39:54-10:40:09", "quote": "how do you decide when a feature that's being discussed should be a microservice or stay in the existing" },
      "by": "model", "verified": "quote-found" },
    { "id": "said:1:service-or-monolith", "kind": "stage-answer", "stage": 1,
      "text": "Answered with the decision rule (independent deployment, ownership, scaling) and the Helcim example; did not give a figure.",
      "fields": { "question": "asked:1:service-or-monolith", "used": ["achievement:helcim:release-cycles"], "gaps": ["no metric given"] },
      "source": { "id": "stage:1:transcript:2026-10-08", "revision": "1", "locator": "10:40:12-10:41:25", "quote": "…" },
      "by": "model", "verified": "quote-found" },
    { "id": "signal:1:data-ownership", "kind": "employer-signal", "stage": 1,
      "text": "The hiring manager pressed on data ownership and business boundaries: expect it again, with more depth, in the technical round.",
      "fields": { "carriesTo": [2] }, "source": { "…": "…" }, "by": "model", "verified": "quote-found" },

    // ── research the person added, extracted the same way ───────────────────────────────────
    { "id": "research:zensurance:products", "kind": "employer-fact",
      "text": "Sells commercial insurance to Canadian small businesses online, across many carriers.",
      "source": { "id": "research:zensurance/company-overview.md", "revision": "1", "locator": "section 'What they sell', paragraph 1", "quote": "…" },
      "by": "model", "verified": "quote-found" },

    // ── LINKS: what proves what (a model proposes, code checks both ends exist) ─────────────
    { "id": "fit:requirement:third-party-apis", "kind": "fit",
      "text": "Strong: Relay Platform multi-carrier quoting (carrier adapters, 8 weeks, $3M impact); also Helcim provider adapters.",
      "fields": { "requirement": "requirement:third-party-apis", "strength": "strong",
                  "evidence": ["achievement:relay:carrier-adapters", "achievement:relay:i5-platform"], "gap": null },
      "by": "model", "verified": "ends-exist" },
    { "id": "fit:requirement:nestjs", "kind": "fit",
      "text": "Partial: NestJS used alongside Laravel and Node services at Helcim; no project led on NestJS alone.",
      "fields": { "requirement": "requirement:nestjs", "strength": "partial", "evidence": ["achievement:helcim:service-seams"],
                  "gap": "Name the NestJS work precisely; do not claim ownership of a NestJS platform." },
      "by": "model", "verified": "ends-exist" },
    "…"
  ],

  "review": { "rejected": [ { "kind": "employer-fact", "text": "Series C funded", "reason": "quote-not-found" } ],
              "unconfirmed": 3, "confirmedByPerson": 12 }
}
```

How each part is produced:

| Part of the pack | Produced by | From | Checked by |
|---|---|---|---|
| `stages`, people, dates | the form, stored as fields | the Interview form | schema |
| `candidate-profile`, `candidate-role` | code | matrix | hash of the matrix |
| `candidate-achievement` | code composes role + proof point + metric into one sentence | matrix | every part has a matrix locator |
| `employer-requirement`, `employer-fact` | **model**, schema-constrained, one call per source or per chunk of a source | posting, research, employer-said | the quote must occur in the source |
| `prep-note` (per stage) | **model** splits and labels the person's notes; keeps their words | stage notes | quote found |
| `stage-question`, `stage-answer`, `employer-signal` | **model** | a stage's transcript | quote found; times within the transcript |
| `fit` (requirement ↔ evidence, with strength and gap) | **model** proposes links | requirements + achievements | both ends exist; a gap is never offered as experience |
| `themes`, `answers` on a record | **model** adds search words and the questions a record answers | the record | closed vocabulary where one exists |
| `review` | code | everything a check refused | shown to the person |

## 6. End state (design): how a model is given the pack, and how it knows what to read

There are two ways, chosen by what the model can hold, and both go through the same recipe.

**A. Selection in code (today's way, improved).** For a question, code resolves a projection:
exact fields, then ranked slots, using the question's terms, the `themes` and `answers` the
pack added, the `fit` links (a selected requirement brings its evidence; a selected prep note
brings its proof), and the stage (a stage's own records lead; an earlier stage's questions and
signals follow). The prompt lists the chosen facts with pointers; the model cites; code
verifies. Used by the live coach, where two seconds matter, and by any small model.

**B. The pack as a tool (new).** A model with a large context and tool use (Claude Code, Codex)
is given the pack's index (the stages, the kinds and counts, the requirements by title) and
three read-only tools over the same prepared pack: `find(query, kind?, stage?)`,
`get(id)` and `related(id)` (follow `fit`, `proof` and `question` links). It decides what to
read; every fact it reads has an id it must cite; code verifies the citation exactly as in A.
Used for documents, briefings and long answers, where being thorough matters more than two
seconds.

Either way the rule that makes it trustworthy is the same and already holds for the coach:
**a model may only assert what it can point at, and code checks the pointer.**
