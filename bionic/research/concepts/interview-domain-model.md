---
title: "Interview domain model and database"
slug: interview-domain-model
type: concepts
tags: [interview, domain-model, database, tenancy, drizzle]
sources: []
last_reviewed: 2026-10-02
---

# Interview domain model and database

Interview Studio stores its hiring domain in PostgreSQL, in tables declared
with Drizzle and secured by row-level security. Briefing packs, Workspace
drafts, rehearsals and Knowledge work on their own; the domain tables link to
them by id.

The tenancy and storage rules this model implements are decided in
[[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]; package
ownership of schemas is decided in
[[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]. The
checkable rules are pinned as `observed` invariants in [[invariants/index]].

Provenance: filed from the former `docs/architecture/interview-domain.md`
(commit `4c50c5e`).

## Domain tables

```
platform    tenants · users · tenant_memberships · …
interview   companies · people · member_people · candidacies · interviews
            interview_participants · briefing_links
practice    exercises · exercise_attempts
```

- **Company:** an employer. Two similar names are two companies.
- **Person:** anyone in a hiring relationship (you, a recruiter, an
  interviewer), with an optional `title` and `company_id`.
- **Member person:** maps a workspace member to their Person.
- **Candidacy:** your relationship with one company for one opportunity, from
  `exploring` to an end state.
- **Interview:** one round of a candidacy, with its `ordinal`, `kind` (plus a
  `label`), time, `format` and `status`.
- **Interview participant:** a person's `role` in an interview; `other`
  requires a `role_label`.
- **Briefing link:** links a briefing pack (`briefing_id`, the pack's artifact
  id) to a candidacy and/or an interview.
- **Exercise:** a coding question: prompt, `kind`, `difficulty`, tags and
  source. `tenant_id` is null for a shared exercise and set for a private one.
- **Exercise attempt:** a member's Workspace draft (`draft_id`) solving an
  exercise in one language. Private to that member.

`briefing_id` and `draft_id` have no foreign key: briefing packs and drafts
are keyed per actor in Interview Studio's own tables.

## Tenancy and isolation

- A tenant is a workspace. Every domain row carries `tenant_id`.
- Workspace roles (`owner | admin | member`) are permissions; hiring roles are
  participant relationships. Neither is part of a user's identity.
- Isolation has two layers:
  - **Forced row-level security** on reads and writes, so it binds the
    tables' owner too. The policy is
    `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`.
  - **Composite foreign keys** on `(tenant_id, id)`, so a row never
    references a row in another workspace.
- `exercises` is readable where `tenant_id` is null or the current tenant, and
  writable only for the current tenant. `exercise_attempts` also requires
  `user_id = app.actor_id`.
- The app connects as a role that is neither a superuser nor exempt from
  row-level security.

## Database packages

- **`@omnitech/database`** owns connectivity, `withTenant()`, the table
  convention helpers and migration execution.
- **Schemas belong to their packages:**
  - `platform-storage`: `platform` and `ai`
  - the presentation product: `presentation`
  - the interview product: `interview` (Interview Studio's tables in
    `studio.ts`, the domain in `schema.ts`) and `practice`
- The assistant package owns the `assistant` schema and ships its own
  migrations.

### `withTenant()`

```ts
withTenant(context: { tenantId; actorId }, work: (db) => Promise<T>, options?)
```

The only way to get a tenant-scoped Drizzle handle:

1. Refuses a connection whose role is a superuser or bypasses row-level
   security.
2. Opens a Drizzle transaction on a pooled client.
3. Sets `app.tenant_id` and `app.actor_id` transaction-locally, so a pooled
   connection never carries them into another request.
4. Runs `work`; a nested transaction inside it is a savepoint.
5. Commits, or rolls back on any error.

### Conventions

`tenantColumns()` gives every tenant-owned table its `id`, `tenant_id`,
`created_by`, timestamps and `UNIQUE (tenant_id, id)`. `tenantReference()`
builds each composite foreign key with an index on its columns, and
`tenantPolicy()` the row-level security policy.

## Migrations

`migrateDatabase()` (`pnpm --filter @omnitech/database db:migrate`) brings a
database to the current schema:

1. The assistant package's migrations, then the run worker's policies on the
   assistant's tables.
2. The Drizzle stream in `packages/database/drizzle`, recorded by name in
   `drizzle.__drizzle_migrations`. Generated migrations come from the schema
   files; a custom migration carries what Drizzle cannot declare (forced
   row-level security and the triggers that keep recorded answers, evidence
   and finished effect receipts immutable).

After changing a schema file, run `pnpm --filter @omnitech/database
db:generate` and commit the new migration.

## Tests

- **`packages/database/src/migrate.test.ts`:** a fresh database reaches the
  current schema, and a second run changes nothing.
- **Schema drift tests**, one per schema owner: every declared table, column,
  foreign key and policy exists in a migrated database.
- **`products/interview/src/backend/db/security.test.ts`:** cross-tenant
  reads, writes and references are refused; the owner is bound by row-level
  security; shared exercises and private attempts behave as above; every
  tenant-owned table has forced row-level security.

## Invariants

1. Every tenant-owned table has `tenant_id`, forced row-level security on
   reads and writes, and composite tenant foreign keys.
2. No tenant-scoped database handle exists outside `withTenant()`.
3. Schema files and migrations agree; the drift tests enforce it.
4. Briefing packs and Workspace drafts work on their own. Domain links are
   optional.

Items 1–3 are pinned as `observed` candidates in [[invariants/index]]; item 4
is a design property of the model above. Item 2 holds for Drizzle handles; at
commit `4c50c5e` raw `pg` client code still uses the `database` package's
`tenantTransaction`, which sets the same transaction-local tenant context (see
[[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]).
