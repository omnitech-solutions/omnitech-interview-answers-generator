# Backend DRY audit — backend pass

Read-only audit taken on 2026-10-10 while other refactors were moving files: judge the patterns,
not the line numbers. Scope measured: 313 non-test TypeScript files, about 68,850 lines
(`products/interview/src/backend`, `products/presentation/src` minus the frontend, `apps/web`,
`packages/platform-api`, `platform-runtime`, `platform-storage`, `interview-storage`, `database`,
`platform-integrations`, `interview-api-client`, `interview-contracts`, `platform-contracts`,
`active-session-contracts`). Counts are grep and node counts. "Verified" means a sample of the
sites was read. `PI` = `products/interview/src/backend`, `PP` = `products/presentation/src`.

## 1. Transport

Route totals: **186 Hono registrations in 15 files.**

| File | Routes |
|---|---|
| `PI/api.ts` | 46 |
| `PI/documents/api.ts` | 29 |
| `PP/backend/api.ts` | 25 |
| `PI/live-session/routes.ts` | 24 |
| `PI/brief/routes.ts` | 21 |
| `PI/briefing/api.ts` | 12 |
| `apps/web/src/platform/agent-api.ts` | 6 |
| `PI/plan/api.ts` | 5 |
| `PI/briefs/api.ts` | 4 |
| `packages/platform-api/src/router.ts` | 3 |
| `PI/context-pack/routes.ts` | 3 |
| `PI/studio/host.ts` | 3 |
| `PI/interview-backend.ts` | 2 |
| `PI/rehearsal/api.ts` | 2 |
| `apps/web/src/platform/api.ts` | 1 |

Plus 10 Next `route.ts` files in `apps/web` (not read).

### T1. Bounded body reader, hand-rolled beside the helper

- Shape: check `content-length > limit` → `getReader` loop counting bytes → cancel and throw a
  local TooLarge → `JSON.parse`.
- Helper exists: `packages/platform-contracts/src/bounded-json.ts`
  `readBoundedJson(request: Request, limitBytes: number): Promise<{ok:true,value}|{ok:false,reason:"too-large"|"invalid"}>`.
- Users of the helper: 3 (`PI/api.ts` `readBody`, `agent-api.ts` `readAgentBody`,
  `PP/backend/api.ts` middleware). Each wraps it again to turn the reason into 413/400: 3 copies
  of that mapping.
- Hand-rolled: 4 files. `PI/brief/routes.ts` (`boundedBody` + `jsonBody`), `PI/documents/api.ts`
  (`boundedBody` + `jsonBody`), `PI/live-session/routes.ts` (`boundedBytes` + `jsonBody`),
  `PI/context-pack/routes.ts` (`boundedJson`). The last calls `request.text()` first and measures
  afterwards, so it buffers an oversize body whole: weaker than the helper.
- Each throws its own error: `BriefError("body-too-large")`, `RequestTooLarge`, `BodyTooLarge`.
- Gap: the helper returns JSON only; three of the hand-rolled ones also need bytes for multipart
  uploads. A `readBoundedBytes` sibling would cover both.
- Removable: about 80–100 lines. Verified: yes (all 7 read).

### T2. Scope and same-origin middleware copied per sub-API

- Shape: `scope = await options.resolveScope(req)`; no scope → 401 `{error:{code:"unauthorized"}}`;
  method not GET/HEAD → compare origin, host and `sec-fetch-site` → 403 `origin-forbidden`;
  `context.set("<x>Scope", scope)`.
- Count: 7 `context.set("...Scope")` middlewares; `sec-fetch-site` checked in 8 files. A
  verbatim-identical 18-line block in `PI/plan/api.ts`, `PI/briefs/api.ts`, `PI/rehearsal/api.ts`;
  the same shape in `PI/documents/api.ts`, `PI/live-session/routes.ts`; variants in
  `PI/briefing/api.ts`, `PI/api.ts`.
- Helper exists: `apps/web/src/platform/api-safety.ts` `originGuard: MiddlewareHandler` (already
  mounted on `/api/*`), 1 user. Products cannot import `apps/web`, so the in-product copies repeat
  it. The variable name also differs per file (`planScope`, `briefScope`, `rehearsalScope`,
  `documentScope`, `briefingScope`, `scope`).
- Removable: about 90–110 lines with one `scopedApp(resolveScope, allowedOrigins)` in the product.
  Verified: yes (3 read in full, the others by grep).

### T3. Error-to-status tables: 10 `onError` handlers, 6 tables, 4 response envelopes

- Tables and mappers:
  - `packages/interview-contracts/src/live-session.ts` `LIVE_SESSION_ERROR_STATUS` (the good
    model: one table in contracts, typed by `satisfies Record<Code, number>`)
  - `PI/live-session/routes.ts` `REFUSAL_STATUS`
  - `PI/brief/routes.ts` `STATUS` (9 codes)
  - `PI/context-pack/routes.ts` `STATUS` (3 of the same codes, re-declared)
  - `PI/briefing/api.ts` `errorStatus` (nested ternary on `WorkspaceError.code`)
  - `PI/assistant/workspace.ts` `WorkspaceError` constructor (derives status from code: a second
    copy of the same knowledge)
  - `PP/backend/failures.ts` `FAILURES` rows
  - `PI/documents/api.ts` `onError` (a 14-branch `instanceof` ladder over 14 classes)
- `onError` handlers: `PI/api.ts`, `PI/briefing/api.ts`, `PI/briefs/api.ts`,
  `PI/documents/api.ts`, `PI/live-session/routes.ts`, `PI/plan/api.ts`, `PI/rehearsal/api.ts`,
  `PI/studio/host.ts`, `PP/backend/api.ts`, `apps/web/src/platform/api.ts`. Plan, briefs and
  rehearsal are the same 4–8 lines (`ZodError|SyntaxError` → 400 `invalid-request`;
  `WorkspaceError` `not-found` → 404).
- Notable: `WorkspaceError` already carries a status (it extends `ProductOperationError`), and
  `PI/studio/host.ts` uses it through `productOperationFailure(error)`; plan, briefs and briefing
  re-derive the status from the code by hand.
- Envelopes in use: `{error:{code}}` 41 sites in 11 files; `{error:"text"}` 24 sites in 3 files
  (agent-api 16, presentation 7, `apps/web` api 1); `apiError()`
  `{error:{code,message,requestId}}` 54 sites, `PI/api.ts` only; `{code,message}` in
  `PI/studio/host.ts`.
- Two identical `route(work)` try/catch wrappers: `PI/brief/routes.ts` and
  `PI/context-pack/routes.ts`. A third, data-driven one in `PP/backend/api.ts`
  `route(failures, run)` with rows in `failures.ts`: the closest existing model for "one data
  entry per route".
- Removable: about 120–150 lines if each error family owns one code→status table in contracts and
  one shared `respondError`. Verified: yes.

### T4. Validation

- `safeParse(`: 74 in 33 files (`PI/api.ts` 16, `PI/live-session/routes.ts` 8).
  `XSchema.parse(`: 168 in 29 files.
- Two styles coexist: throw and let `onError` answer (plan, briefs, rehearsal, brief, documents,
  presentation) versus `safeParse` plus an inline `apiError` (`PI/api.ts`). `PI/api.ts` has 23
  body reads, 16 `safeParse` and 19 `try` blocks for 46 routes.
- The exact number of `safeParse` blocks immediately followed by a 400: not checked.
- Raw `req.json()` with no size bound: 9 sites in 5 files (`PI/studio/host.ts` 3,
  `PI/plan/api.ts` 3, `PI/rehearsal/api.ts` 1, `PI/briefs/api.ts` 1,
  `packages/platform-api/src/router.ts` 1). Verified by grep.

### T5. Id params

`const uuid = z.uuid()` re-declared in `PI/brief/routes.ts`, `PI/context-pack/routes.ts`,
`PI/documents/api.ts`; the UUID regex written 3 times (`PI/interview-backend.ts`,
`PI/live-session/errors.ts`, `PI/rehearsal/api.ts`); `isUuid` exported from
`PI/live-session/errors.ts`, used in 5 files. Removable: about 10 lines.

### T6–T8. Pagination, idempotency, streaming

- Pagination: 3 files only (`PI/api.ts` 5 hits, `PI/live-session/routes.ts` 4 with a local
  `pageNumber`, `agent-api.ts` 2). `pageSize` is defined in both
  `PI/live-session/session-pages.ts` and `session-reads.ts`. Below the two-call-site bar for a
  helper today.
- Idempotency: 16 files mention it; key handling lives in `PP/repositories/index.ts` (7),
  `PI/assistant/workspace.ts`, `PI/live-session/session-standing.ts` and `engine-call.ts`. No
  shared shape seen; not read in depth.
- Streaming: one helper already, `PI/work-guards.ts` `ndjsonResponse`, `createInFlight`,
  `linkedAbort`; 2 route users (documents, context-pack). No hand-rolled SSE found. Nothing to do.

## 2. Services

### S1. Failure styles: three coexist

- Thrown domain errors: 44 `class X extends Error` (listed in section 9). Throws:
  `WorkspaceError` 105, `SessionError` 92, plain `Error` 88, `BriefError` 45, `DocumentNotFound` 23.
- `{ok:true}|{ok:false,...}`: 16 named union types; 64 `ok: false` literals in 16 files. The
  failure field has 5 names: `reason` (7 types), `violations` (3), `issues` (2), `failure` (1),
  `refused` (1). Examples: `PI/live-session/assist-stage.ts`, `coding-stage.ts`, `claims.ts`,
  `core/status.ts`, `engine-call.ts`, `fenced-writes.ts`,
  `packages/platform-contracts/src/bounded-json.ts`,
  `packages/interview-contracts/src/studio-host.ts`.
- `kind:`-tagged outcomes: 3 named unions (`PI/live-session/coding-path.ts` `Generated`,
  `core/ports.ts` `TaskDecision`, `core/tasks.ts` `TaskOutcome`); `outcome: "..."` 54 literals in
  9 files.
- The type scan caps a type body at 600 characters, so the named-type counts are a floor.
  Verified: counts only, not read.

### S2. Dependency bags

12 named: `IngestDependencies`, `CoreDependencies`, `CoachPorts`, `SessionProcessorPorts`,
`DispatchDeps`, `SessionStorePort`, `SessionClaimPort`, `CoachContextPort`,
`AgentEscalationPort`, `WorkspaceDatabasePort`, `PlatformApiServices`,
`InterviewBackendServices`. Plus 45 `*Options` types, several carrying injected collaborators
(`database`, `resolveScope`, `generate`). `resolveScope: (request) => Promise<Scope|null>` is
declared 6 times. The six ports were checked: each has a test fake or a second implementation
(`memory-session-world.ts`, `processor-fixture.ts`, `workspace-fixture.ts`, `coach.test.ts`,
`apps/agent-worker`), so none is a delete candidate.

### S3. Forwarding service

`PP/application/index.ts` (174 lines): 20 of 22 methods are
`return this.repository.sameName(context, ...)`; only `importPowerPointTheme` and `export` do
work. Under ADR-0042 point 3 this is the service layer, but today it deletes nothing: either the
transaction boundary and authorisation move into it, or the route calls the repository for the
20. Verified: yes.

### S4. Not checked

Authorise/load/decide/persist skeletons and transaction plus post-commit publish. `.publish(` and
notify appear in only 4 files.

## 3. Repositories

### R1. Scope predicate as a copied string

- Shape: `const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3"`;
  `const ids = (scope) => [tenantId, actorId, productId]`; `... WHERE ${scoped} AND id=$4`,
  `[...ids(scope), id]`.
- 5 copies: `PI/plan/repository.ts`, `PI/briefing/repository.ts`, `PI/briefs/api.ts`,
  `PI/rehearsal/api.ts`, and `PI/assistant/workspace.ts` (the same text under the names `where`
  and `values`). 21 `${scoped}` uses. Two of the five are route files holding SQL.
- Removable: about 25 lines; the larger gain is one definition. Verified: yes.

### R2. Tenant entry

- `withTenant(`: 21 sites in 10 files (9 inside the route file `PI/documents/api.ts`).
- `tenantTransaction(`: 31 sites in 8 files (`PP/repositories/index.ts` 21).
- `enterTenant(` by hand: 6 sites (`PI/assistant/workspace.ts`,
  `PI/live-session/session-purge.ts`, `packages/platform-storage` `agent-job-repository`,
  `bootstrap`, `document-artifact-repository`, `platform-repository`).
- Bare `.transaction(`: 58 sites in 20 files (many go through
  `InterviewWorkspaceRepository.transaction`, which does enter the tenant).
- The same 6-line `scoped(c, work)` wrapper around `withTenant` sits in `PI/brief/routes.ts` and
  `PI/context-pack/routes.ts`.

### R3. Privileged transaction with a transaction-local flag

- Shape: `database.transaction(async client => { await client.query("SELECT set_config('app.<flag>', 'on', true)"); return work(client) })`.
- 14 sites in 10 files: `PI/live-session/session-claim.ts` (`asSessionWorker`),
  `packages/platform-storage/src/agent-job-worker-repository.ts` (`asWorker`),
  `agent-job-repository.ts` (2), `document-artifact-repository.ts` (2),
  `PI/documents/repository.ts`, `PI/interview-backend.ts`,
  `PI/live-session/credential-lookup.ts`, `session-purge.ts` (2), `PI/assistant/workspace.ts`
  (`product_id`), `PP/repositories/index.ts` (`share_token_hash`).
- No helper in `packages/database`. Candidate: `withSetting(database, name, value, work)` beside
  `withTenant`. Removable: about 40 lines. Verified: yes (grep lines plus two read).

### R4. Lease claim: two implementations

`PI/live-session/session-claim.ts` (`claimSessions`, fence, `renewLease`) and
`packages/platform-storage/src/agent-job-worker-repository.ts` (`claim`, `renewLease`). Same
skeleton (candidate `SELECT ... FOR UPDATE SKIP LOCKED` → `UPDATE` holder and
`lease_expires_at = now() + $ms` → `RETURNING`), different tables and rules. `skip locked` 3
sites; lease columns 33 hits in 8 files. Only two sites and the SQL differs materially: not worth
abstracting. Verified: yes.

### R5. Explicit tenant predicates

`eq(x.tenantId, ...)` 66 sites in 9 files (`PI/brief/repository.ts` 30,
`PI/documents/repository.ts` 24); raw `tenant_id=$1` 86 sites in 17 files
(`PP/repositories/index.ts` 32, `PI/live-session/session-purge.ts` 26). The
`and(eq(tenantId), eq(id))` form: 5. `ownedSession` is defined twice
(`PI/live-session/repositories/capture.repository.ts` and `session.repository.ts`). Not read in
depth.

### R6. Compare-and-swap and upserts

`revision + 1` 14 sites in 6 files; `"revision-conflict"`/`RevisionConflict` 34 sites in 6 files.
`onConflictDoUpdate` 1, `onConflictDoNothing` 5, raw `ON CONFLICT` 18 sites in 7 files. Not read.

### R7. Row mappers

Only 4 named `toX(row)` functions (`PI/live-session/session-record.ts` 2, `session-reads.ts` 1,
`packages/platform-storage/src/agent-job-row.ts` 1); most mapping is inline. `.toISOString()` 56
sites in 25 files, and a local `iso` helper is defined 5 times with 3 different signatures
(`PI/brief/repository.ts`, `PI/briefs/api.ts`, `PI/plan/repository.ts`,
`PI/live-session/session-choices.ts`, `session-record.ts`).

### R8. Row-level security predicate written by hand in schema files

`current_setting('app.tenant_id'`: 79 lines across `PP/backend/db/schema.ts` 28,
`PI/db/studio.ts` 24, `packages/platform-storage/src/schema/ai.ts` 14, `schema/platform.ts` 11.
Helper exists: `packages/database/src/conventions.ts` `tenantPolicy(table, tenantId)` and
`tenantPredicate(tenantId)`; `tenantPolicy` has 1 user (`PI/db/schema.ts`), `tenantPredicate` 2.
The `::text` casts suggest these files were introspected, so confirm they are hand-owned before
touching them. Removable if hand-owned: about 70 lines.

## 4. Contracts

- **C1. Primitive schemas re-declared.** `id = z.string().trim().min(1).max(256)` 5 times
  (`interview-contracts` `assistant.ts`, `briefing.ts`, `plan.ts`; `PI/assistant/workspace.ts`;
  `PI/briefing/api.ts`); `revision` 4 times in 3 slightly different forms (one coerces);
  `text = (max) => z.string().trim().min(1).max(max)` in `brief.ts`, `plan.ts`, `rehearsal.ts`;
  `line` in 4 contract files; `isoTime` twice with different strictness. Removable: about 20
  lines; the real gain is one definition of an id.
- **C2. JSON Schema hand-written beside zod.** 31 `type:"object"`/`additionalProperties:false`
  blocks in 9 files (`PI/live-session/assist-stage.ts` 15, `coding-stage.ts` 4,
  `PI/documents/generate.ts`, `cast.ts`, `PI/context-pack/recipe.ts`, `eval/answers.ts`,
  `PP/domain/generation.ts`). `assist-stage.ts` says a test keeps the two in step.
  `z.toJSONSchema` is already used in 4 files (`PI/assistant/adapter.ts`, `PI/structured.ts`,
  `PI/documents/api.ts`, `packages/active-session-contracts/src/wire-schema.ts`). Removable:
  roughly 150–200 lines in `assist-stage` and `coding-stage` if the provider accepts the
  generated form; not checked.
- **C3.** Field-list duplication between a contracts package and backend or frontend files: not
  checked.

## 9. Logging and errors

### L1. Failure logger copied

`console.error(JSON.stringify({ route, error: error instanceof Error ? error.name : "non-error", ...code }))`:
6 sites. `PP/backend/failures.ts`, `apps/web/src/platform/agent-api.ts`, `PI/api.ts` (all three
named `logFailure`), `apps/web/src/platform/api-safety.ts`, `PI/interview-backend.ts`,
`apps/web/instrumentation-node.ts`. Helper exists: `packages/logging`
`createLogger(options: LoggerOptions): Logger` with `redactFields`; 6 users in scope, only 2
files call `log.<level>` directly. Removable: about 40 lines. Verified: yes.

### L2. Error subclasses (44)

With fields: `InterviewApiError[status,details]`, `WorkspaceError[code,status,hint]`,
`SessionError[code,reason,uncoveredTables]`, `BriefError[code]`, `ContextPackError[reason]`,
`AiFailureError[code]`, `ContextSnapshotError[code]`, `ScreenshotLoadError[code]`,
`SessionContextUnavailable[code,reason]`, `CoachCallError[failure]`,
`DocumentModelFailure[failure]`, `DocumentVerificationFailed[fields]`,
`MigrationMismatchError[status]`, `LibrarySlugConflictError[slug]`,
`DuplicateProductError[productId]`, `DuplicateRouteError[routeId]`,
`ProductUnavailableError[productId]`, `PlaygroundGuideInvalidError[path]`.

Field-less marker classes (26): `DocumentNotFound`, `DocumentRevisionConflict`,
`DocumentAlreadyExists`, `DocumentSaveCancelled`, `DocumentRetryConflict`,
`DocumentContextNotFound`, `InvalidDocumentTemplateError`, `RequestTooLarge`, `InvalidField`,
`TargetUnavailable`, `GenerationFailed`, `RequestCancelled`, `DocumentSourceChanged`,
`BodyTooLarge`, `PackPreparationCancelled`, `ReplayMaterialError`, `LibraryStateError`,
`LibraryIndexUnavailableError`, `PreviewImportRefusedError`, `PreviewCompileError`,
`UnauthorizedError`, `PresentationNotFoundError`, `PresentationThemeNotFoundError`,
`PresentationConflictError`, `ExportRefusedError`, `ImageAssetRefusedError`.

The documents slice alone has 14 marker classes and a 14-branch ladder; the brief slice does the
same job with one `BriefError(code)` and one 9-row table. Converging documents on the code and
table shape removes about 40–60 lines.

### L3. Catch blocks

134 in 62 files (`PI/api.ts` 19, `PI/live-session/processor.ts` 13,
`PI/live-session/routes.ts` 9); `.catch(() => undefined)` 29 sites in 22 files. Not read
individually.

## 12. Across products, and product versus package

- **X1. API client `request()`.** The same 18-line fetch → json → extract `error.code` → throw
  `InterviewApiError` → `schema.parse` function is in all 5 modules of
  `packages/interview-api-client/src` (`briefs.ts`, `plan.ts`, `rehearsal.ts`, `briefing.ts`,
  `index.ts`), with 3 identical `{baseUrl, fetch?}` option interfaces. Removable: about 60 lines.
  Verified: 2 read in full, 5 counted.
- **X2.** Interview and presentation each own a body middleware around `readBoundedJson`, a
  `logFailure`, a route try/catch wrapper and an unhandled-500 `onError`. See T1, T3, L1.
- **X3. Small utilities repeated.** Recursive `canonical(value)` 3 copies
  (`PI/briefing/repository.ts`, `PI/documents/context.ts`,
  `PI/live-session/context-snapshot.ts`) plus `canonicalJson` twice (`PI/assistant/workspace.ts`
  and the exported `PI/live-session/canonical-json.ts`); the sha256-hex one-liner 5 copies;
  `squash` 3; `renderPrompt` in both `assist-stage` and `coding-stage`; `TIMING`/`SPOKEN` in
  `PI/coach-transcript.ts` and `PI/coach/transcript-file.ts`. About 50 lines.

## Under-used helpers

| Helper | Users | Hand-rolled |
|---|---|---|
| `readBoundedJson` | 3 | 4 files |
| `originGuard` | 1 | 7 in-product copies |
| `tenantPolicy` | 1 | about 79 hand-written policy lines |
| `createLogger` | 6 | 6 JSON `console.error` loggers |
| `WorkspaceError.status` / `productOperationFailure` | 1 (`studio/host.ts`) | 3 files re-map by hand (plan, briefs, briefing) |
| `canonicalJson` (exported) | 4 files | 4 private re-implementations |
| `z.toJSONSchema` | 4 files | 9 files with hand JSON Schema |

## Delete or flatten candidates

- `PP/application/index.ts` (20 forwarding methods).
- `PI/context-pack/routes.ts` `STATUS` and `route()` (duplicates of `brief/routes.ts`).
- `PI/briefing/api.ts` `errorStatus` (duplicates the `WorkspaceError` constructor).
- Options no caller passes: not checked.

## Not read

The 10 Next `route.ts` handlers and `apps/web` auth and middleware;
`packages/platform-integrations`; `packages/platform-runtime` beyond grep; service skeletons and
post-commit publish; idempotency internals; individual catch blocks; contract versus backend or
frontend field-list duplication; `PI/live-session` core and handlers beyond grep; whether the
schema files with hand-written policies are generated. `bionic/objectives.md` was not read
(ADR-0042 was).

## Ranked: the ten backend items with the largest effect

Ranked by lines removed weighed against how many cross-cutting concerns stop being the caller's
to remember. The typed surfaces are proposals, except where a helper already exists (marked
"exists"). Line counts are estimates from the sections above.

| # | Name | Sites | Helper's typed surface | Where it lives | Lines removed | Directory touched by the conversion |
|---|---|---|---|---|---|---|
| 1 | Error family → one status table and one responder (T3, L2) | 10 `onError` handlers, 6 tables, 14 document marker classes | `respondError(c, error, table: Record<Code, Status>): Response`, table typed `satisfies Record<Code, number>` | table in `packages/interview-contracts` (as `LIVE_SESSION_ERROR_STATUS` does); responder in `products/interview/src/backend` | 160–210 | `products/interview/src/backend/{documents,brief,briefing,briefs,plan,rehearsal,context-pack}` |
| 2 | JSON Schema generated from zod (C2) | 31 hand blocks in 9 files | `z.toJSONSchema(schema)` (exists) | zod; one wrapper at most in `products/interview/src/backend/structured.ts` | 150–200, if the provider accepts the generated form | `products/interview/src/backend/{live-session,documents,context-pack}`, `products/presentation/src/domain` |
| 3 | Scoped sub-API: scope and same-origin in one call (T2) | 7 middlewares, 8 origin checks | `scopedApp<S>(options: { resolveScope: (r: Request) => Promise<S \| null>; allowedOrigins?: readonly string[] }): Hono<{ Variables: { scope: S } }>` | `products/interview/src/backend` (products cannot import `apps/web`) | 90–110 | `products/interview/src/backend/{plan,briefs,rehearsal,documents,briefing,live-session}` |
| 4 | Bounded body reader (T1) | 4 hand-rolled, 3 re-wrapped | `readBoundedJson(request, limitBytes)` (exists) plus `readBoundedBytes(request: Request, limitBytes: number): Promise<{ok:true;bytes:Uint8Array}\|{ok:false;reason:"too-large"\|"invalid"}>` | `packages/platform-contracts/src/bounded-json.ts` | 80–100 | `products/interview/src/backend/{brief,documents,live-session,context-pack}`, `apps/web/src/platform` |
| 5 | Row-level security policy from the convention (R8) | about 79 lines in 4 schema files | `tenantPolicy(table: string, tenantId: AnyPgColumn)` (exists) | `packages/database/src/conventions.ts` | about 70, only if the files are hand-owned | `products/presentation/src/backend/db`, `products/interview/src/backend/db`, `packages/platform-storage/src/schema` |
| 6 | API client request (X1) | 5 copies, 3 option interfaces | `createRequest(options: { baseUrl: string; fetch?: typeof fetch }, path: string, what: string): (suffix: string, method?: string, body?: unknown) => Promise<unknown>` | `packages/interview-api-client/src` | about 60 | `packages/interview-api-client/src` |
| 7 | Failure logger (L1) | 6 hand-rolled | `createLogger(options: LoggerOptions): Logger` (exists) | `packages/logging` | about 40 | `products/interview/src/backend`, `products/presentation/src/backend`, `apps/web/src/platform` |
| 8 | Privileged transaction with a local setting (R3) | 14 sites in 10 files | `withSetting<T>(database: PlatformDatabase, name: string, value: string, work: (client: DatabaseClient) => Promise<T>): Promise<T>` | `packages/database` beside `withTenant` | about 40 | `packages/platform-storage/src`, `products/interview/src/backend/{live-session,documents}`, `products/presentation/src/repositories` |
| 9 | Forwarding presentation service (S3) | 20 of 22 methods | none: delete the forwards, or move the transaction boundary and authorisation in | `products/presentation/src/application` | about 120 | `products/presentation/src/{application,backend}` |
| 10 | Scope predicate and small shared values (R1, C1, X3, T5) | 5 `scoped` copies with 21 uses; `id` 5, `canonical` 5, sha256 5, `iso` 5, `uuid` 6 | `scopedWhere: string`, `scopeValues(scope: WorkspaceScope): [string, string, string]`; `idSchema`, `revisionSchema`; `canonicalJson(value: unknown): string` (exists) | `products/interview/src/backend/assistant/workspace.ts` for the predicate; `packages/interview-contracts` for the schemas | about 100 | `products/interview/src/backend/{plan,briefing,briefs,rehearsal,documents,live-session,context-pack}`, `packages/interview-contracts/src` |
