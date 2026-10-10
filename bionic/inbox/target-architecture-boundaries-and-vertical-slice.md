# Target architecture: application boundaries and a data-driven vertical slice

Owner's direction, 2026-10-10. Unprocessed input: the source for an ADR, a rules reference and the
refactor plan. Product name: OmniTech Studio.

## 1. The rule

> Contracts define the shape. Domain functions define the rules. Services coordinate the
> operation. Repositories persist the state. Next.js exposes the capability.

A modular monolith organised by business capability. A boundary is a responsibility, not an excuse
for a class, interface, factory, dependency-injection container or package per function.

| Concern | Responsibility | Must not own |
|---|---|---|
| Transport / API | Next.js and Hono routes, authentication, request validation, HTTP responses | business rules, SQL |
| Application services | Use cases, authorisation, orchestration, transaction boundaries | JSX, HTTP rendering, SQL text |
| Domain | Business rules, policies, state transitions, decisions; ideally pure functions | I/O |
| Repositories | Drizzle queries, persistence, joins, locking, database mapping | HTTP handling, business policy |
| Database infrastructure (`@omnitech/database`) | Connections, tenant context, transactions, RLS, migrations | product rules |
| Contracts | Typed inputs and outputs, validation schemas | React, Next.js |
| Integrations | AI providers, background jobs, artifacts, external events | UI state |
| UI library (`@oc-tech/omni-ui-components`) | Every reusable control, form, table, layout | product business logic |
| Product frontend | Composition, configuration, a small controller per screen, the typed API client | SQL, credentials, authorisation |

Not all raw SQL is bad: a complex PostgreSQL-specific operation may use parameterised SQL through
Drizzle **inside a repository**. The defect is SQL in the wrong layer, bypassing the database
boundary. Drizzle is not forced into Active Record: row types come from Drizzle; domain types and
services exist where they add separation.

## 2. Backend example: `live-session/ingest.ts`

Problems in the roughly 1,000-line file: hardcoded SQL throughout business operations (session
lookup, observation insert, membership check, counters, screenshot artifacts); business logic mixed
with persistence (inside `ingestLocked()`); too many responsibilities (authorisation, domain
decisions, protocol handling, rate limiting, side effects); `IngestOptions` mixing request options,
callbacks, runtime dependencies and test overrides; transaction orchestration mixed with SQL;
best-effort callbacks after commit with weak isolation.

Target shape (a target, not a requirement to create every directory):

```
products/interview/src/backend/live-session/
  contracts/      ingest.ts, events.ts
  domain/         observation.ts, session-policy.ts, session-transition.ts
  services/       ingest.service.ts, session.service.ts
  repositories/   session.repository.ts, observation.repository.ts, capture.repository.ts
  handlers/       heartbeat.handler.ts, observation.handler.ts, capability.handler.ts,
                  voice-activity.handler.ts
  infrastructure/ event-publisher.ts, ingest-unit-of-work.ts
  db/             schema.ts
  index.ts
```

Migration order: characterisation tests that pin today's behaviour; extract persistence into
repositories; separate domain and protocol handlers; simplify the application service; then verify
concurrency, tenant isolation and post-commit behaviour.

## 3. Frontend and full slice example: the document editor

Refactor what exists; do not rebuild. Worth keeping: `@omnitech/interview-contracts` (document
fields, groups, value validation, revision-aware edits); `InterviewDocumentRepository` (Drizzle,
tenant scope); revision history, source verification, field regeneration, previews, exports;
`DocumentPreview` (maps preview text back to field keys); the library's `DynamicForm`, `Splitter`,
`Panel`, `Button`.

The editor must not hold hardcoded fields, a separately kept field layout, or its own input
controls. Instead: the template describes the editable fields; `DynamicForm` renders the controls;
the revision snapshot supplies values; field metadata and validation supply read-only, required and
error states; the preview uses the same field keys; document actions stay product features shown
through library controls.

Target files (illustrative; extract in this order, never all at once):

```
products/interview/src/frontend/studio/documents/
  document-editor.tsx       small composition root (Splitter, Panel, form, preview)
  document-form.tsx         DynamicForm adapter
  document-form-config.ts   template fields -> schema + uiSchema; grouped <-> flat values (pure)
  use-document-editor.ts    draft, revision, mutation, preview state (one controller)
  document-preview.tsx      existing
  documents-client.ts       existing typed client
products/interview/src/backend/documents/
  api.ts                    Hono wiring and transport only
  document.service.ts       editing and review use cases
  repository.ts             existing persistence owner (keeps the compare-and-swap on revision)
```

Rules for the form adapter: values stay a flat `Record<string, string>` in storage; the grouped
projection is lossless both ways (unique keys; every declared field survives a round trip); a field
bound to an authoritative source is read-only from field metadata, not from labels; required is
conditional (optional repeating blocks stay valid when absent: keep `documentLayout()` and
`validateDocumentValues()` as the authority); the server validates regardless of what the UI
disables; preview selection focuses the field through a generic focus capability of the form, not a
CSS selector.

Controller state: server state (revision, field definitions, verification, exports) stays
server-owned; draft state (unsaved values, selected field, dirty) is the local copy; presentation
state (collapsed sections, zoom) is local. Keep the 250 ms debounced preview with
`AbortController`, and guard against out-of-order responses. Keep save-on-blur for now; never a
revision per keystroke.

Backend: the route parses and delegates; the service loads under scope, rejects an older revision,
rejects changes to source-bound fields, evaluates validation and provenance, asks the repository to
persist, returns the result; the repository keeps the atomic compare-and-swap on
`currentRevision` inside one tenant transaction. Never replace that with a read-then-write.

## 4. Configuration versus code

Configuration represents variation; code represents behaviour.

| Configuration-driven | Explicit code |
|---|---|
| Field labels, sections, order | Revision concurrency protocol |
| Which widget presents a field | Tenant authorisation |
| Toolbar presentation and availability | Command implementation |
| Template selection and format | Domain verification rules |
| Field display hints, filter options, status presentation | Source ownership decisions; AI invocation and cancellation |

Typed action descriptors for a toolbar are right; a declarative interpreter of business steps
(`steps: ["authorize","validate","lock","update"]`) is a second programming language and is wrong.

## 5. Refactor in verifiable slices

1. Baseline: capture real behaviour (browser workflows, current tests).
2. Extract pure configuration (round-trip tests; optional blocks and order preserved).
3. Integrate the library form for one bounded area (keyboard, errors, read-only, callbacks).
4. Extract the controller (stale responses, cancellation, conflicts).
5. Compose from library parts (end-to-end, responsive, visual).
6. Extract use cases from the Hono module (request-level behaviour and permissions unchanged).
7. Narrow the repository (real PostgreSQL tenant, transaction and concurrency tests).
8. Remove retired code (dead CSS, unused helpers; knip; full gate; browser regression).

Regression cases that must hold: one edit makes exactly one revision; a stale `baseRevision` cannot
overwrite; no cross-tenant read or write; a source-bound field cannot be changed by a crafted
request; an absent optional block validates and exports; an unsupported claim stays flagged; an
earlier preview cannot overwrite a newer one; preview selection focuses the field; cancelling
regeneration leaves the last revision intact; an older revision is read-only until restored.

Traps: no one-file-to-ten-files move without evidence; do not replace working contracts; do not
combine UI replacement, schema migration and policy change in one diff; a green build is not proof
of UI correctness; library first (extend the library, with stories and tests, then re-vendor).

## 6. Done means

Frontend mostly composition of library components with a small controller; fields, sections and
controls derive from metadata; no duplicate field definitions; use cases read top to bottom; SQL and
Drizzle isolated in repositories; tenant scope, source ownership, RLS and permissions still
enforced; revisions, preview, cancellation and exports behave as before; replaced code has no
consumers; tests exercise behaviour. The goal is less code for the same function, with clear
ownership and configuration-driven presentation: not textbook clean architecture.
