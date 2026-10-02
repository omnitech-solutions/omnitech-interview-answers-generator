# Interview domain architecture

> **Canonical domain state is created only through explicit application
> commands. Models may generate preparation, evidence analysis and
> suggestions, but never canonical facts.**

## Purpose

Interview Studio grew around product surfaces (Workspace, Briefings,
Knowledge, Rehearsal). Each keeps its own persistence, and the hiring domain
lives in disconnected strings: the company and role on a briefing pack, the
company on the interview plan, and the employers inside the experience matrix
are unrelated text. Nothing learned in one interview reaches the next.

This document defines the stable model the product moves to. Hiring
relationships and the people in them become first-class. The product
surfaces become views and capabilities over that model, and what one interview
reveals becomes reviewed evidence for the next.

## Domain map

```
Platform      Tenant · TenantMembership · User · Artifact · ArtifactRevision
Network       Person · Company · Employment
Career        CandidateProfile · EmploymentEvidence
Hiring        Job · Candidacy · CandidacyStage · Interview · InterviewParticipant · Debrief
Preparation   Briefing · Rehearsal · PreparationPlan (later) · PreparationItem (later)
Knowledge     typed artifact links · reviewed debrief revisions · reusable knowledge
```

| Area | Owns | Notes |
|---|---|---|
| **Platform** | tenants (workspaces), memberships, users, artifacts and their revisions | A tenant is the workspace and the ownership boundary. The product maps each member to their Person in the workspace (`member_people`), so platform tables never reference product tables. |
| **Network** | Person, Company, Employment | People include the candidate, recruiters, interviewers and referrals. Employment is a person's role at a company over time. |
| **Career** | CandidateProfile (the experience matrix), EmploymentEvidence | The matrix is one evidence source, not the career model. |
| **Hiring** | Job, Candidacy, CandidacyStage, Interview, InterviewParticipant, Debrief | Candidacy is the aggregate root of an interview journey. |
| **Preparation** | Briefing packs, rehearsals, and later preparation plans | Capabilities that hang off the domain, not domain aggregates. |
| **Knowledge** | typed artifact links, reviewed debrief revisions, reusable knowledge | Content that later work cites as evidence. |

## Core entities

- **Person**: anyone in a hiring relationship. It may link to a platform user,
  but it doesn't have to.
- **Company**: an employer, either worked at or interviewed with. Identity is
  explicit. Name similarity only ever produces suggestions, never merges.
- **Employment**: a person's title (and team) at a company over a period.
- **Job**: a specific opening, with its posting and pay band. It is optional
  for a candidacy.
- **Candidacy**: one person's hiring relationship with one company for one
  opportunity. It exists before any formal application, for example from
  recruiter outreach, a referral, or a direct invitation. It always has a
  company, and gains a job only when one is known. Its `status` covers the
  whole lifecycle, from `exploring` to an end state.
- **CandidacyStage**: one step of a candidacy (recruiter screen, take-home,
  onsite, references, offer…). A stage contains zero or more interviews.
  `kind` is extensible and `label` is required, so code uses `kind` only for
  defaults.
- **Interview**: one session within a stage, with its time, format and status.
- **InterviewParticipant**: a person's role in an interview: candidate,
  interviewer, recruiter, hiring manager, coordinator, observer, or something
  else with a free-text label.
- **Debrief**: the interview's reviewed write-up. The interview owns its
  lifecycle, and its reviewed revisions become evidence.
- **Artifact**: a transcript, job description, email, note, take-home brief,
  offer letter and so on. Content lives in immutable revisions. Artifacts
  relate to many entities through typed links.

Offers (immutable revisions, so terms that change keep their history),
communications (emails, messages, calls) and preparation plans are part of
the target model. They are built later, and Candidacy is the entity they
attach to.

## Ownership and tenancy

- Every domain row carries `tenant_id`, the workspace that owns it. Records
  are shared with the workspace's members. Today a workspace has one member,
  so nothing becomes visible to anyone new.
- Roles in a workspace (`owner | admin | member`) are permissions. Hiring
  roles (recruiter, interviewer, candidate) are relationships between people
  and interviews. **Neither is a property of a user's identity.**
- Isolation has two layers:
  - **Row-level security** decides what a session can see and write. Each
    tenant-owned table checks `tenant_id` against the transaction's tenant,
    for both reads and writes, and security is forced.
  - **Composite foreign keys** decide what a row may reference. A child row
    references `(tenant_id, parent_id)`, so a row in one workspace can never
    point at a parent in another.
- Tenant-scoped database access exists **only** inside a tenant transaction,
  which sets the tenant (and actor) for that transaction alone. Without a
  tenant context, access fails closed.

## Four layers of state

| Layer | Contents | Written by | Mutability |
|---|---|---|---|
| **1. Canonical state** | Network and Hiring entities | application commands only, from user actions or accepted suggestions | mutable |
| **2. Evidence** | artifact revisions, matrix revisions, reviewed debrief revisions | users (uploads, reviews) | immutable |
| **3. Generated preparation** | briefing packs, debrief drafts, concept briefs, rehearsals | models, then reviewed by the user | drafts are mutable; reviewed revisions are not |
| **4. Inference** | Assistant replies, extraction output, proposals | models | never writes layer 1 |

Review never changes a revision. A debrief points at its current revision and
at its reviewed revision, and reviewing simply moves the second pointer.

## Suggestions

Inferred or untrusted knowledge reaches canonical state through one path:

```
evidence → domain suggestion → user acceptance → application command → canonical state
```

- A suggestion proposes a command and records its evidence, origin
  (`migration | transcript | assistant | import`), descriptive confidence,
  reasoning, optional target candidacy, and a stable source fingerprint.
- **A suggestion is never a partial entity.** No canonical query combines
  real rows with pending suggestions.
- Accepting a suggestion runs the current application command and records the
  decision in the same transaction. If the command fails, the suggestion
  stays open.
- Dismissing is final for that source: the fingerprint stops it from coming
  back.

## Evidence

- **Citations are always to an immutable revision plus a locator** (for
  example artifact revision 3 at `#/turns/14`). A citation stays reproducible
  forever.
- Artifact revisions keep the **raw source** alongside the parsed structure
  (such as transcript turns) and the parser's version. A better parser later
  produces a new revision rather than rewriting an old one.
- One retrieval abstraction serves every consumer: the Assistant, briefing
  generation, debrief generation and preparation.

  ```ts
  type EvidenceHit = {
    sourceKind: "artifact" | "debrief";
    sourceId: string;
    revisionId: string;
    locator: string;
    excerpt: string;
    score?: number;
  };
  ```

- **Validation:** every factual citation must resolve to an immutable locator.
  Quotes are matched against a normalized form of that revision (whitespace,
  punctuation, Unicode). Figures (pay, dates, team size, metrics, percentages)
  must appear in cited evidence.

## Read models and service boundaries

Generation and the Assistant read the domain through purpose-built context
services, never by querying tables ad hoc:

- `getInterviewPreparationContext(interviewId)` returns:
  - the candidate, company, job, candidacy, stage and interview
  - the participants and their employment
  - company research and the job description
  - **selected** reviewed debrief findings, plus references to searchable
    evidence

  Debrief findings are classified (`company_fact | role_fact | team_fact |
  person_fact | process_fact | candidate_feedback | open_question | risk`),
  and preparation selects the categories relevant to the interview it is
  preparing for.
- `getCandidacyAssistantContext(candidacyId)` returns a canonical summary, a
  reviewed-evidence summary, what evidence is searchable, and open
  suggestions.

Repositories expose read methods per use case (`getCandidacySummary`,
`getInterviewTimeline`…), not whole-aggregate loading. Database row types stay
private to storage. Framework-neutral contracts (`interview-contracts`) are
what APIs and the UI speak.

## Persistence

- PostgreSQL. Drizzle ORM defines the schemas and runs one database-wide
  migration stream. Each domain package owns its schema definitions and
  repositories. `packages/database` owns connectivity, tenant-scoped
  transactions and migration execution.
- The Assistant's `assistant` schema stays owned by `omnitech-assistant` and
  outside the Drizzle stream.
- Existing hand-written repositories keep working and adopt Drizzle only when
  they are next changed.

## Migration principles

- **Preserve truth rather than maximise relational completeness.** Create
  only what existing data proves. Everything else becomes a suggestion.
- **Never infer** jobs, stages, interviews, participants or offers from loose
  text.
- Legacy records (pack JSON, plans, matrix revisions) are never modified.
- Data migrations are **frozen programs**, recorded per tenant with a
  checksum. They never call mutable application code.
- Each generated record keeps its source in a provenance table. Re-runs match
  on where data came from, not on its current values, so renaming a record
  can't cause a duplicate.
- A wrong split is easy to fix and a wrong merge isn't, so ambiguous groupings
  stay apart and are offered as merge suggestions.
- Rollback is safe before anyone edits the new records. Afterwards, legacy
  data still lets the app fall back, and provenance allows controlled
  cleanup.

## Roadmap

| # | Sub-project | Primary invariant |
|---|---|---|
| 1 | **Foundation** | Schema, tenancy, row-level security and migration behaviour are correct |
| 2 | **Interviews** | Canonical hiring state is editable without AI; the conservative backfill and suggestion review work |
| 3 | **Evidence** | Immutable artifacts can be ingested, searched and cited |
| 4 | **Debriefs** | Generated analysis becomes reviewed evidence, never canonical state |
| 5 | **Next-stage preparation** | Preparation is grounded in canonical state plus reviewed evidence |

Each depends only on the ones before it. Sub-projects 2–5 get detailed specs
only after the one before them ships.

## Key invariants

1. Models never write canonical state.
2. Every tenant-owned row has `tenant_id`, row-level security on reads and
   writes, forced security, and composite tenant foreign keys.
3. No tenant-scoped database handle exists outside a tenant transaction.
4. Evidence is immutable, and every citation resolves to a revision and a
   locator.
5. Review moves pointers; it never changes revisions.
6. Briefing packs stand on their own. Links to the domain are optional.
7. Historical data migrations are frozen and recorded per tenant.

## Non-goals (for now)

- Recruiter-facing workflows, multi-member collaboration features, or sharing
  between workspaces. The model allows them, but they are not built.
- Audio, PDF or Word ingestion, and integrations with mail, calendars,
  LinkedIn or meeting scribes.
- Cross-company analytics, and claim-consistency warnings across stages.
- Replacing Home's interview plan before preparation plans exist.
