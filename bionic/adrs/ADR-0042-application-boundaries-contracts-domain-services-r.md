---
id: ADR-0042
title: "Application boundaries: contracts, domain, services, repositories, transport; UI from the library only, data-driven"
status: Accepted
date: 2026-10-10
proposed_date: 2026-10-10
accepted_date: 2026-10-10
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0003, ADR-0004, ADR-0023]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [architecture, boundaries, services, repositories, sql, ui-library, forms, data-driven]
related_briefs: [BRIEF-web-app-on-the-ui-library-only]
related_research: []
governs: []
---

# ADR-0042 — Application boundaries: contracts, domain, services, repositories, transport; UI from the library only, data-driven

## Context

ADR-0003 draws boundaries between packages and ADR-0004 between products and the shell. Neither
says what a module inside a product may own, and ADR-0023 says which SQL may be raw without saying
which layer may hold SQL at all. Inside those limits the code grew modules that hold a route, the
use case, the business rule and the SQL together: an ingest module of about 1,000 lines, an API
module of about 2,000, SQL written in routes and services, forms built by hand from raw elements,
and stylesheets beside a UI library that already has the parts. The owner's direction of
2026-10-10 (`bionic/inbox/target-architecture-boundaries-and-vertical-slice.md`) is that this must
not be able to happen again: the end state is proper use of boundaries, with behaviour in business
services and variation in data.

## Decision

Contracts define the shape. Domain functions define the rules. Services coordinate the operation.
Repositories persist the state. Transport exposes the capability. A boundary is a responsibility,
not a reason for a class, an interface, a factory or a package per function (ADR-0002 still
governs), and no universal directory structure is required: a module is judged by what it owns.

1. **Persistence.** SQL text and the Drizzle query builder appear only in a repository module and
   in the database package. A repository owns queries, joins, locking and the mapping to and from
   rows, and no business policy. Parameterised raw SQL is allowed there, and only there, for a
   PostgreSQL-specific operation the builder cannot express, on the terms of ADR-0023.
2. **Transport.** A route parses and validates the request, resolves who is asking, delegates to
   one service call and shapes the response. It holds no business rule, no SQL, no query builder,
   no tenant transaction and no import of a table schema.
3. **Services.** An application service owns one use case from top to bottom: authorisation,
   orchestration, the transaction boundary and the order of side effects. It asks repositories to
   read and write and holds no SQL text, no HTTP rendering and no JSX.
4. **Domain.** Business rules, policies, state transitions and decisions are pure functions: no
   I/O, no clock or randomness that is not passed in, no framework import.
5. **Contracts.** Typed inputs and outputs and their validation schemas are the one statement of a
   shape, and import neither React nor Next.js.
6. **Configuration and code.** Configuration represents variation (labels, sections, order, which
   widget, availability, options); code represents behaviour (concurrency, authorisation, command
   implementation, verification rules). A declarative interpreter of business steps is a second
   programming language and is not allowed.
7. **Product frontends and the shell.** A screen is composed from UI library parts, with one
   controller per screen holding its draft and server state and one typed API client. A form is
   declared as data and rendered by the library's dynamic form; a new hand-built form is not
   allowed. No custom stylesheet, class string, inline style or raw layout or control element is
   added. When the library lacks something, an option on an existing part is preferred to a new
   variant, and the part is extended in the library first, never copied into the product. A
   frontend imports no backend internals and no database package.
8. **One responsibility per file.** No file mixes three or more of transport, service, domain,
   persistence and presentation. A backend module above the size limit the checks state is split
   by responsibility, not by line count.
9. **Debt only goes down.** Each requirement above has a mechanical check in the verification
   gate. Today's violations are listed once per check with a path and a count; a new violation
   fails, and so does a listed count that is no longer true, so every refactor lowers the list.

The layer map, allowed imports and commands for this repository are in
`bionic/research/references/application-boundaries.md`; the checks are the source of truth for
the limits and the listed debt.

### Worked scenarios

| Situation | Outcome |
|---|---|
| A route needs one more column from a table | The repository gains or widens a method; the route still calls the service |
| A locking claim needs `SKIP LOCKED` | Parameterised SQL inside the repository, with its reason on the raw-SQL list |
| A screen needs a new input | A field in the form's declaration; no new element, class or stylesheet |
| The library has no fitting part | An option on a library part, with a story and a test, then re-vendored |
| A refactor moves SQL out of a listed file | The file's listed count is lowered in the same change, or the gate fails |

## Alternatives Considered

### Option A — Keep ADR-0003, ADR-0004 and ADR-0023 and rely on review
- **Pros:** nothing to write or run.
- **Cons:** those records were in force while the mixed modules were written; review did not stop it.
- **Why not:** the owner asked that it be impossible, which needs a check that fails.

### Option B — A fixed directory layout per capability, enforced by path
- **Pros:** simplest possible check.
- **Cons:** forces ten files where one function is enough, against ADR-0002, and turns a
  responsibility rule into a naming rule that is satisfied by moving a file.
- **Why not:** the defect is SQL and policy in the wrong layer, not a missing folder.

### Option C — Migrate everything first, then state the rule
- **Pros:** the lists would start empty.
- **Cons:** thousands of changed lines before any protection exists, while new code keeps arriving.
- **Why not:** a ratchet protects from today and lets the migration proceed slice by slice.

## Consequences

**Positive:**
- A new module cannot put SQL in a route or a service, build a form by hand or add a stylesheet
  without the gate failing and naming this record and the reference page.
- The remaining debt is one visible number per rule, and it can only fall.
- Use cases read top to bottom, and persistence can be tested against PostgreSQL on its own.

**Negative:**
- Every refactor that pays debt must also lower a listed number, which is a second edit.
- The checks read source text and syntax, so they can be satisfied in letter by renaming a file;
  the reference page and review still carry the intent.
- A small feature in an old module may need a repository method first.

**Follow-on work:**
- Migrate the listed modules in the order the reference page gives, one slice per change, with a
  characterisation test first.
- Extend the UI library where the brief lists a gap, before the page that needs it.
- Accept or amend ADR-0004, which is still Proposed and which this record refines.

## References

- `bionic/inbox/target-architecture-boundaries-and-vertical-slice.md` (the owner's direction)
- [[briefs/BRIEF-web-app-on-the-ui-library-only]]
- [[research/references/application-boundaries]]
- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]] (amended: boundaries inside a package)
- [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]] (amended: the inside of a product vertical)
- [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]]
- [[adrs/ADR-0023-use-the-query-builder-by-default-and-check-the-dat]] (amended: the layer that may hold SQL)
