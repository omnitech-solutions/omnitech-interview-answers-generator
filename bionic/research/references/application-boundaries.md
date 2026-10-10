---
title: "Application boundaries: where code belongs"
slug: application-boundaries
type: references
tags: [architecture, boundaries, routes, services, repositories, sql, drizzle, forms, components, css, ui-library]
sources: []
last_reviewed: 2026-10-10
---

# Application boundaries: where code belongs

> Contracts define the shape. Domain functions define the rules. Services coordinate the operation.
> Repositories persist the state. Transport exposes the capability.

The decision is [[adrs/ADR-0042-application-boundaries-contracts-domain-services-r]]. This page is
its map for this repository. A boundary is a responsibility, not a folder: no layout below is
required, and one function is never split into ten files (ADR-0002). The checks are
`scripts/application-boundaries.test.ts`; the debt they tolerate is
`scripts/application-boundaries-debt.ts`.

## You are about to write X: it belongs in Y

| You are about to write | It belongs in | Never in |
|---|---|---|
| A `sql` template, SQL in a string, `.select().from()`, `.insert().values()`, a join, a lock | a repository: `repository.ts`, `*.repository.ts` or `repositories/` of the capability; a table in `backend/db/` | a route, a service, a domain function, a frontend file |
| `withTenant(...)`, `tenantTransaction(...)`, the order of writes and side effects | the application service of the use case (`*.service.ts`) | a route, a handler, a component |
| "May this happen?", a state transition, a policy, a validation rule | a pure domain function: arguments in, decision out, no I/O, clock passed in | a repository, a route, a component |
| A Hono route, request parsing, a status code, `c.json(...)` | the transport module (`api.ts`, `routes.ts`, `*.handler.ts`): parse, authorise, one service call, respond | a service |
| The shape of a request, a response or a stored value; a zod schema | a contracts package (`@omnitech/interview-contracts`, `@omnitech/active-session-contracts`, `@omnitech/platform-contracts`) | a route body, a component |
| A model, image or agent call | through `@omnitech/ai-engine`, called from a service by profile or capability | a route, a repository, a component |
| A label, a section, an order, which widget, an option list, availability | configuration: a typed table or the form's declaration | an `if` chain in a component |
| A form | data (schema and UI schema) rendered by the library's `DynamicForm`, values from the server snapshot | `<form>`, `<input>`, `<select>`, `<textarea>`, a field per `useState` |
| A button, panel, table, layout, spacing, colour | a part of `@oc-tech/omni-ui-components`; missing? add an option to the part in the library (story and test), re-vendor, then compose | a `div` with a `className`, an inline `style`, a `.css` file, a copy of the part in the product |
| Draft, selection, the fetch, stale-response guards for one screen | one controller hook for that screen (`use-<screen>.ts`) calling the typed API client | scattered across the screen's components |

## Allowed imports, by layer

| Layer (how a path is recognised) | May import | Must not import |
|---|---|---|
| Contracts (`packages/*-contracts`) | zod, other contracts | React, Next.js, Hono, Drizzle, `@omnitech/database` |
| Domain (pure functions in a capability) | contracts | everything that does I/O |
| Repository (`repository.ts`, `*.repository.ts`, `repositories/`, `backend/db/`) | `drizzle-orm`, the capability's `db/` schema, the transaction handle from `@omnitech/database`, contracts | Hono, Next.js, React, the AI engine, a service |
| Service (`*.service.ts`, `services.ts`) | repositories, domain, contracts, `withTenant`/`tenantTransaction` from `@omnitech/database`, `@omnitech/ai-engine` | Hono, Next.js, React, `drizzle-orm`, a `db/` schema, SQL text |
| Transport (`api.ts`, `*-api.ts`, `routes.ts`, `router.ts`, `*.handler.ts`, `handlers/`, a Next.js `route.ts`) | Hono, contracts, services | `drizzle-orm`, a `db/` schema, `@omnitech/database` transactions, repositories directly |
| Product frontend (`products/*/src/frontend/**`) | React, `@oc-tech/omni-ui-components`, contracts, `@omnitech/interview-api-client` | `src/backend/**`, `@omnitech/database`, `@omnitech/platform-storage`, `@omnitech/interview-storage`, `drizzle-orm`, `apps/web`, a `.css` file |
| Shell (`apps/web`) | the registered products' public entry points, platform packages, the UI library | a product's internal files, a database driver or builder (see `scripts/web-thinness.test.ts`) |
| Database (`packages/database`) | `drizzle-orm`, `pg` | any product or domain rule |

Package entry points and tenant rules stay as ADR-0003, ADR-0005 and ADR-0023 state them. Read the
Drizzle and PostgreSQL rows of [[research/references/technology-references]] for the query itself,
and [[research/references/ui-components]] for the library's vocabulary.

## What went wrong here, and the shape that replaces it

**SQL in a route or a service.**

```ts
// before: routes.ts
app.post("/sessions/:id/end", async (c) => {
  await tenantTransaction(pool, scope, (tx) =>
    tx.execute(sql`update live.sessions set status = 'ended' where id = ${id} and status = 'active'`));
  return c.json({ ok: true });
});

// after: the route delegates, the service decides, the repository persists
app.post("/sessions/:id/end", async (c) => c.json(await sessions.end(scopeOf(c), c.req.param("id"))));
// session.service.ts
const session = await repository.load(tx, id);
const next = endSession(session, now);            // pure: domain/session-transition.ts
if (!next.ok) return next;
await repository.saveStatus(tx, id, next.status); // the only place that knows the table
```

**A 1,000-line ingest (`live-session/ingest.ts`).** One function looks up the session, checks
membership, decides, inserts, counts, stores artifacts and publishes. Target: contracts for the
event shapes; `domain/` for the observation and session policy; `repositories/` for session,
observation and capture; one handler per event kind; a service of a screenful that reads top to
bottom. Options become a request type plus injected ports, not one bag of callbacks and test hooks.

**A 2,000-line API module (`documents/api.ts`).** Hono wiring, validation, use cases and SQL in
one file. Target: `api.ts` is wiring only; `document.service.ts` holds editing and review;
`repository.ts` keeps the compare-and-swap on the current revision inside one tenant transaction
(never a read-then-write).

**A hand-built form.**

```tsx
// before
<form onSubmit={save}><label className="bp-label">Company<input value={company} onChange={...} /></label></form>
// after: fields are data; the template or contract is the one definition
<DynamicForm schema={schema} uiSchema={uiSchema} formData={draft} onChange={setDraft} onSubmit={save} />
```

**Custom CSS.** `<div className="doc-toolbar" style={{ gap: 8 }}>` with a rule in `documents.css`
becomes library parts (`Splitter`, `Panel`, `Button` and their options). A missing option is added
in the library, not in the product.

## Migration order (one slice per change)

1. A characterisation test that pins today's behaviour of the slice (request level for a route,
   real PostgreSQL for persistence, a browser claim for a screen).
2. Extract the repository: move every statement, unchanged, behind named methods.
3. Extract the domain: pull decisions out as pure functions with unit tests.
4. Extract the service: authorisation, transaction, order of effects; it reads top to bottom.
5. Thin the route to parse, authorise, delegate, respond.
6. Frontend: pure configuration first, then the library form for one bounded area, then the
   controller, then composition from library parts; delete the retired CSS and helpers last.

Never combine a UI replacement, a schema migration and a policy change in one diff. A green build
is not proof a screen is right: check it in the browser.

## How to work here

- [ ] Run the `technology-references` skill row for the path you touch; read this page first.
- [ ] Characterisation test first, then repository, domain, service, thin route. One slice.
- [ ] New code obeys the tables above from its first line: no new entry in any debt list.
- [ ] After the refactor, lower or delete the entries you paid in
      `scripts/application-boundaries-debt.ts` (and `scripts/ui-migration-audit.ts`,
      `scripts/raw-sql-guard.test.ts` where they list the same file). The numbers must go down;
      never raise one to pass.
- [ ] `pnpm exec vitest run --project node scripts/application-boundaries.test.ts`, then
      `pnpm verify`.

## The tripwires

| Rule | Fails on | List |
|---|---|---|
| a | SQL text outside a repository, a schema declaration and `packages/database` | `sqlOutsideRepositories` |
| b | a query-builder chain or a tenant transaction in transport or frontend code | `persistenceInTransport` |
| c | a route module importing a table schema | `schemaImportsInTransport` |
| d | a product frontend importing backend internals or a database package | `backendImportsInFrontend` |
| e | a backend module over 400 lines; a file mixing three or more responsibilities | `oversizedBackendModules`, `mixedResponsibilities` |
| f | a new raw layout element, `className`, inline `style`, stylesheet, CSS import or raw field, per screen directory | `handBuiltUi` |
| g | a new raw `<form>` | `rawForms` |

Each also fails when a listed number is higher than what exists. `pnpm boundaries:update`
recomputes every list from the current tree; review its diff (a number that rose is a new
violation to fix, not to accept).
