# Interview domain architecture

> **Canonical domain state is created only through explicit application
> commands. Models may generate preparation and analysis, but never canonical
> facts.**

## Purpose

Interview Studio stores its hiring domain as disconnected strings. The company
and role on a briefing pack and the company on the interview plan are
unrelated text, and nothing learned in one interview reaches the next. Coding
questions are one-off Workspace drafts, so asking the same question twice
creates two unrelated drafts.

This architecture adds just enough domain to fix that:
- a **candidacy** ties a company, its interviews and the people in them
  together
- a **debrief** carries what one interview revealed into preparing for the
  next
- an **exercise** gives coding questions a catalog

Everything else in the product stays as it is and links to these.

## Domain map

```
Platform    Tenant · TenantMembership · User · Artifact · ArtifactRevision
Network     Company · Person
Hiring      Candidacy · Interview · InterviewParticipant · Debrief
Practice    Exercise · ExerciseAttempt
```

Existing capabilities link to the domain rather than becoming part of it.
Briefing packs, Workspace drafts, rehearsals and Knowledge are unchanged.

## Entities

- **Company:** an employer you're talking to. Identity is explicit: two
  similar names are two companies until you say otherwise.
- **Person:** anyone in a hiring relationship: you, a recruiter, an
  interviewer. A person may have a current `title` at a `company`.
  *Leaves room for: employment history over time.*
- **Candidacy:** your hiring relationship with one company for one
  opportunity. It exists before any formal application (recruiter outreach, a
  referral, an invitation). `status` covers its lifecycle, from `exploring` to
  an end state. *Leaves room for: a separate Job once postings matter.*
- **Interview:** one round of a candidacy, with its order, `kind` (an
  extensible list plus a required `label`), time, format and status.
  *Leaves room for: grouping interviews into stages (an onsite) when needed.*
- **InterviewParticipant:** a person's role in an interview (candidate,
  interviewer, recruiter, hiring manager, coordinator, observer, other).
- **Debrief:** an interview's write-up. It is generated from the transcript,
  then **reviewed by you**. The interview owns it, and reviewed revisions are
  evidence for later rounds.
- **Artifact:** uploaded or pasted content, a transcript first. Content lives
  in immutable revisions that keep the raw text and its parsed structure
  (speaker turns).
- **Exercise:** a coding question in the catalog: prompt, kind, difficulty,
  tags and source. *Leaves room for: exercise revisions, per-language test
  cases and reference solutions.*
- **ExerciseAttempt:** links an exercise to **an existing Workspace draft**
  in one language. The draft keeps doing everything it does today: versions,
  tests, guide, Assistant.

## Ownership and tenancy

- A tenant is the workspace and owns every domain row through `tenant_id`.
  Today each workspace has one member, so nothing becomes visible to anyone
  new.
- The product maps each member to their Person (`member_people`). That Person
  is "me", the default candidate. Platform tables never reference product
  tables.
- Workspace roles (`owner | admin | member`) are permissions. Hiring roles are
  participant relationships. **Neither is part of a user's identity.**
- Isolation has two layers:
  - **Row-level security** on reads and writes, **forced** so it applies even
    to the table owner.
  - **Composite foreign keys** on `(tenant_id, id)`, so a row can never
    reference a row in another workspace.
- Tenant-scoped database access exists only inside `withTenant()`, using
  transaction-local settings. Without a tenant context, access fails closed.
- **Exercises are the one shared table.** `tenant_id` is null for a shared
  catalog exercise and set for a private one. Questions pasted from real
  interviews are private by default. Attempts are private to the person who
  made them.

## Four layers of state

| Layer | Contents | Written by |
|---|---|---|
| **Canonical** | companies, people, candidacies, interviews, participants, exercises | application commands from user actions |
| **Evidence** | artifact revisions, **reviewed** debrief revisions | users (uploads, reviews); immutable |
| **Generated preparation** | briefing packs, debrief drafts, Workspace answers | models, then reviewed by you |
| **Inference** | Assistant replies and proposals | models; never canonical state |

Review never changes a revision. A debrief points at its current revision and
at its reviewed revision, and reviewing moves the second pointer.

People, dates or next steps a model finds in a transcript appear **in the
debrief** for you to act on. A model never creates them. *Leaves room for: a
suggestion inbox that turns such findings into proposed commands.*

## Evidence

- **Every citation is a revision plus a locator** (for example artifact
  revision 3, `#/turns/14`), so it stays reproducible forever.
- Parsed structure is stored **with** the revision, together with the
  parser's version. A better parser creates a new revision rather than
  rewriting an old one.
- **Validation:** quotes are matched against a normalized form of the cited
  revision. Figures (pay, dates, team size) must appear in cited evidence.
- Retrieval returns one shape to every consumer:

  ```ts
  type EvidenceHit = {
    sourceKind: "artifact" | "debrief";
    sourceId: string; revisionId: string; locator: string;
    excerpt: string; score?: number;
  };
  ```

## How it fits the current app

- **Briefings:** packs stand on their own. A pack can be linked to a candidacy
  and/or an interview, either by creating a candidacy *from* the pack
  (company and role pre-filled) or by picking one. A linked pack for a later
  round is grounded in the candidacy's **reviewed** debriefs.
- **Interviews** (a new view): your candidacies, each with its interviews,
  participants, transcript, debrief and pack.
- **Workspace:** unchanged. Asking a question that matches an existing
  exercise reopens it, and solving it in another language starts a new
  attempt on the same exercise.
- **Recent questions** groups by exercise. A **Practice** list filters by
  kind, tag and difficulty, and shows the languages you've attempted.
- **The Assistant** reads candidacy and debrief context through a context
  service, `getInterviewPreparationContext(interviewId)`, never by querying
  tables directly. It proposes; it doesn't write canonical state.

## Persistence

- PostgreSQL with Drizzle ORM (the 1.0 line, pinned exactly). There is one
  database-wide migration stream, baselined from the current database.
- `@omnitech/database` owns connectivity, `withTenant()` and migration
  execution. The interview product owns its schemas (`interview`, `practice`)
  and repositories, and the platform owns `platform`.
- Existing hand-written repositories keep working unchanged.
- Database row types stay private to storage. `interview-contracts` (Zod) is
  what APIs and the UI use.
- **Nothing is backfilled.** Legacy packs, plans and drafts are never
  modified. You create candidacies yourself, directly or from a pack.

## Delivery

| # | Part | Delivers |
|---|---|---|
| 1 | **Foundation** | `@omnitech/database`, Drizzle, `withTenant()`, the Network/Hiring/Practice tables, the security tests |
| 2 | **Interviews** | the Interviews view; create a candidacy from a pack; participants; pack links |
| 3 | **Practice** | the exercise catalog, Workspace attempts, grouped Recent questions, the Practice list |
| 4 | **Transcripts and debriefs** | transcript ingest, debrief generation and review, next-round packs grounded in reviewed debriefs |

Parts 2 and 3 are independent, and part 4 builds on part 2. Each gets a
detailed spec when it starts.

## Invariants

1. Models never write canonical state.
2. Every tenant-owned table has `tenant_id`, forced row-level security on
   reads and writes, and composite tenant foreign keys.
3. No tenant-scoped database handle exists outside `withTenant()`.
4. Evidence is immutable, and every citation resolves to a revision plus a
   locator.
5. Review moves pointers and never changes revisions.
6. Briefing packs and Workspace drafts work on their own. Domain links are
   optional.
