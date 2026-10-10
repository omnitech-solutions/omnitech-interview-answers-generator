---
title: "DRY opportunities and abstractions that hide complexity from the developer"
slug: dry-opportunities-and-abstractions
type: brief
status: draft
created_at: 2026-10-10
updated_at: 2026-10-10
authors: ["desoleary", "claude"]
tags: [dry, abstractions, transport, services, repositories, frontend, tests, tooling, audit]
related_adrs: [ADR-0002, ADR-0003, ADR-0005, ADR-0023, ADR-0037, ADR-0040, ADR-0042]
---

# DRY opportunities and abstractions that hide complexity from the developer

## Problem

The owner asked: "go through the app code and come up with a comprehensive list of DRY
opportunities and good abstractions and follow the principles I put into most of the projects I
work on which is hide complexities from the dev."

This brief is the audit. No source code was changed. The tree was read on 2026-10-10 at commit
`acad2e5b` with a dirty working tree, while about twelve workers were refactoring it, so the brief
judges patterns and names files, not line numbers. Counts come from
`bionic/briefs/assets/dry-audit/count.sh` (regular expressions over tracked source; approximate by
design) and were confirmed by reading samples. Where a count was not confirmed by reading, the
brief says so. Line savings are estimates.

## The principles this audit is written to

| # | Principle, in his words | Source |
|---|---|---|
| 1 | "Prefer the simplest solution that safely meets the requirement... More code is not progress." Options laid out in increasing complexity; a checkpoint at 1,000 lines or new infrastructure. | `rulesync-bonsai` `rules/simplicity-first.md`; AGENTS.md rule 1; ADR-0002 |
| 2 | "Add an abstraction only for a second implementation or an independent lifecycle." | AGENTS.md rule 1 |
| 3 | "Contracts define the shape. Domain functions define the rules. Services coordinate the operation. Repositories persist the state." A boundary "is a responsibility, not an excuse for a class, interface, factory, dependency-injection container". | `bionic/inbox/target-architecture-boundaries-and-vertical-slice.md`; ADR-0042 |
| 4 | "Configuration represents variation; code represents behaviour." A typed descriptor is right; a declarative interpreter of business steps "is a second programming language and is wrong". | same note, section 4 |
| 5 | One contract authority: "Do not hand-maintain divergent semantic schemas." | `omnitech-rulesync` `content/rules/contracts.md` |
| 6 | Services have one responsibility, explicit inputs and outputs, and return structured errors for expected failures; transports stay thin. | `shared-rulesync-rules` `rules/stacks/rails/services.md` |
| 7 | Explicit configuration: "Never silently fall back". | `omnitech-rulesync` `content/rules/ai-workflows.md` |
| 8 | "Read nearby code before writing new abstractions." Reuse before new. | `rulesync-bonsai` `simplicity-first.md` |
| 9 | One responsibility and one public entry point per package; nobody reaches into its files. | AGENTS.md rule 2; ADR-0003 |
| 10 | Debt only goes down: a mechanical check with an allow-list that may only shrink. | ADR-0042 point 9; `scripts/application-boundaries.ts` |

What "hide complexity from the developer" means here, read from his own code:

| Model | What the developer writes | What they can no longer forget |
|---|---|---|
| `withTenant()` / `tenantTransaction` (`packages/database`) | one call with a scope | the tenant, the database role, row-level security |
| `@omnitech/ai-engine` (ADR-0037, ADR-0040) | one call by profile | provider, retries, tracing, logging rules |
| Behaviour-flags registry (`packages/interview-contracts/src/behaviour-flags.ts`) | one data entry | storage, API, Settings control, worker reading |
| Context-pack recipe (ADR-0038, ADR-0041) | slots and projections as data | the prepare, resolve and render steps |
| Presentation's `FAILURES` table (`products/presentation/src/backend/api.ts`) | one row per route | which error is answered how, and what is logged |

The test applied to every proposal below: the common case becomes one call or one data entry; the
helper applies the cross-cutting concern; the surface is narrow and typed, with no option nobody
passes; it has two or more real call sites today; it deletes more than it adds. Anything that fails
the test is listed under "Do not".

## Counts by category

| Category | What was counted | Number |
|---|---|---|
| Transport | Route registrations | 245 in 30 files |
| Transport | Hand-written bounded body readers | 4 copies (8 functions), beside 1 shared reader with 3 users |
| Transport | `safeParse(` in backend and packages | 75 in 33 files (16 in `backend/api.ts`) |
| Transport | Inline error responses with a literal status | 68 in 11 files |
| Transport | Local `route()` / error-to-status wrappers | 5 different ones |
| Services | `ok: false` result sites | 58 in 15 files |
| Errors | `class X extends Error` | 53 in 35 files |
| Repositories | `withTenant(` 21 in 10 files; `tenantTransaction(` 31 in 8; hand `eq(x.tenantId` predicates | 58 in 5 files |
| AI | Engine request blocks repeating scope, product, permissions, signal | 10 in 9 files (2 files already wrap it locally) |
| Workers | Poll, tick, back-off loop skeletons | 2 (`session-loop.ts`, `coach-loop.ts`) plus `flagged-loop.ts` |
| Configuration | `process.env` reads outside tests | 133 in 52 files; 6 with an inline default; 4 hand-parsed |
| Frontend | `.ok)` checks | 64 in 40 files |
| Frontend | `"content-type": "application/json"` request blocks | 42 in 21 files (16 in Presentation's `index.tsx`) |
| Frontend | Bare `fetch(` beside `studioFetch` | 38 in 9 files (28 in Presentation's `index.tsx`) |
| Frontend | Error and loading setters | 118 in 21 files |
| Frontend | Web storage access | 76 in 27 files; Presentation has `safeStorage`, Interview has none |
| Frontend | Clock, duration and relative-time formatters | 12 functions; `clock` 4 times, relative time 3 times |
| Tests | `flush` 35 files, `advance` 20, `settle` 14, `scopeOf` 11, `installServer` 8, `repoRoot` 7 | local definitions |
| Tests | `vi.mock(` | 162 in 63 files (`@/auth` 9, `@omnitech-assistant/react` 7) |
| Scripts | Hand flag parsers over `process.argv` (`one`, `has`, `list`, `option`) | 4 files; `parseArgs` used 0 times |
| Scripts | Coach scripts repeating API base and token reading | 3 of 3 |
| Scripts | Guard tests using `scripts/guard-support.ts` | 12 of 28; 5 walk files on their own |

## Part 1: the top ten, as work orders ready to run

Ranked by lines removed and by mistakes prevented. Each is independent of the others unless it says
otherwise. "Held by" names the refactor in flight whose directory the conversion touches; the new
helper file itself is always a new file nobody holds. Convert call sites last, one directory per
commit, after the worker holding it has landed.

### WO-1: one bounded body reader (`readBody`)

- **Repeated shape.** `check content-length; read the stream chunk by chunk; cancel past the limit;
  JSON.parse`, then each file's own "too large" error.
- **Sites (4 copies, 8 functions).** `documents/api.ts` (`boundedBody`, `jsonBody`, `upload`),
  `brief/routes.ts` (`boundedBody`, `jsonBody`, `fileBody`), `live-session/routes.ts`
  (`boundedBytes`, `jsonBody`), `context-pack/routes.ts` (`boundedJson`). The shared
  `readBoundedJson` in `packages/platform-contracts/src/bounded-json.ts` has 3 users
  (`backend/api.ts`, Presentation's `api.ts`, `apps/web/src/platform/agent-api.ts`).
- **A defect the copies hide.** `context-pack/routes.ts` reads the whole body with
  `request.text()` and measures it afterwards, so its limit does not bound memory. The shared
  reader does.
- **Surface.** New file `products/interview/src/backend/transport/body.ts`:

  ```ts
  export class BodyRefused extends Error { constructor(readonly code: "body-too-large" | "invalid-request") }
  export function readJson(request: Request, limitBytes: number): Promise<unknown>   // throws BodyRefused
  export function readBytes(request: Request, limitBytes: number): Promise<Buffer>   // throws BodyRefused
  export function readUpload(request: Request, limitBytes: number, field: string): Promise<{ file: File; form: FormData }>
  ```

  `readJson` is `readBoundedJson` with the refusal thrown, so a route's table (WO-2) answers it.
- **Before / after.** Before: 20 lines of reader per file plus `JSON.parse(...)`. After:
  `const input = stageCreateSchema.parse(await readJson(c.req.raw, SMALL_JSON))`.
- **Lines.** About 95 removed, 45 added.
- **Cannot get wrong any more.** An unbounded read; four spellings of "too large".
- **Risk.** The four files answer 413 with slightly different bodies; pin each with its existing
  request test before converting. Low.
- **Tests.** `transport/body.test.ts`: over the limit by header, over the limit by stream, empty
  body, bad JSON, missing file field.
- **Held by.** Conversions touch `documents/`, `brief/`, `live-session/`, `context-pack/`
  (the services and repositories workers). The new file touches nothing.

### WO-2: a route is a failures row plus one function (`handle`, `input`, `param`)

- **Repeated shape.** `read body -> safeParse -> 400 with issues -> try { call } catch { map error
  class or code to a status } -> respond`.
- **Sites.** Five local versions of the same idea: Presentation's `route(FAILURES.x, work)`;
  `brief/routes.ts` `route` + `STATUS` + `id`; `documents/api.ts` `app.onError` chain of
  `instanceof` checks and 21 hand `uuid` parses; `live-session/routes.ts` `errorBody` and
  `refusedResponse`; `backend/api.ts` `apiError` + `libraryMutationError` with about 22 repeats of
  `readBody -> if (!body.ok) return -> safeParse -> if (!parsed.success) return apiError(...)`.
- **Surface.** New file `products/interview/src/backend/transport/route.ts`, lifted from
  Presentation's table and the brief routes' wrapper (reuse before new):

  ```ts
  type Answer = readonly [status: ContentfulStatusCode, code: string];
  export type Failures = {
    known?: readonly (readonly [ErrorClass, ...Answer])[];   // answered, not logged
    codes?: Readonly<Record<string, ContentfulStatusCode>>;  // for errors that carry `.code`
    log?: string;                                            // metadata only, never a message
    otherwise?: Answer;                                      // absent: rethrow
  };
  export function handle<C extends Context>(failures: Failures, work: (c: C) => Promise<Response>): (c: C) => Promise<Response>;
  export function input<T>(c: Context, schema: z.ZodType<T>, limitBytes: number): Promise<T>; // readJson + parse; throws
  export function param(c: Context, name: string): string;                                    // uuid or throws
  ```

- **Before / after** (one site in `backend/api.ts`):

  ```ts
  // before: 16 lines
  const body = await readBody(context, JSON_BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  const parsed = libraryItemInputSchema.safeParse(body.value);
  if (!parsed.success) return apiError(context, 400, "invalid_request", "The Library item is invalid.", ...);
  try { return context.json(await libraryRepository.saveDraft(parsed.data), 201); }
  catch (error) { return libraryMutationError(context, error); }

  // after: 4 lines
  app.post("/api/v1/library/items", handle(LIBRARY_WRITE, async (c) =>
    c.json(await libraryRepository.saveDraft(await input(c, libraryItemInputSchema, JSON_BODY_LIMIT_BYTES)), 201),
  ));
  ```

- **Lines.** About 380 removed, 110 added (one implementation, tables stay as data).
- **Cannot get wrong any more.** A route that forgets the size limit; a route that leaks a zod
  message or an exception message; a new error class nobody mapped (it falls to `otherwise` and is
  logged by name only, AGENTS.md rule 8).
- **Risk.** Medium: the v1 API's error body (`apiError`) and the documents API's
  (`{ error: { code } }`) differ; keep both renderers as an argument of the table, do not unify
  the wire format in the same change. Response bodies are a public contract (principle 5).
- **Not this.** No `steps: [...]` route interpreter, no decorator, no class. Authorisation stays in
  the existing scope middleware and in the service.
- **Tests.** `transport/route.test.ts`: known error answered and not logged; unknown error logged
  by class name only and answered with `otherwise`; no `otherwise` rethrows; zod failure is 400
  with no message text; an error with `.code` uses `codes`.
- **Held by.** `backend/api.ts` (shared by everyone: convert last, in one commit), `documents/`,
  `brief/`, `context-pack/`. Presentation keeps its own copy until a shared home is agreed (see
  "Between the two products").

### WO-3: one typed JSON call for the Studio frontend (`studioJson`)

- **Repeated shape.** `const r = await studioFetch(url, { method, headers: {content-type}, body:
  JSON.stringify(x) }); if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as T`.
- **Sites.** `.ok)` 64 times in 40 frontend files; the JSON header block 42 times in 21 files.
  Examples: `rehearsal/material.ts`, `home/use-plan.ts`, `workspace/use-canonical-draft.ts`,
  `live/overlay/record-transcript.tsx`, `briefings/behavioural/behavioural-pack.tsx`,
  `live/session-client.ts`, `playground-control.ts`, `library.tsx`. One file already has the right
  helper, private to documents: `documents/documents-client.ts` (`checked`, `documentJson`,
  `postJson`, `DocumentsApiError`).
- **Surface.** Add to the existing `products/interview/src/frontend/studio/studio-fetch.ts`
  (move `checked` out of the documents client; do not write a second one):

  ```ts
  export class StudioRequestError extends Error { constructor(readonly status: number, readonly code: string, readonly payload: unknown) }
  export function studioJson<T>(path: string, request?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal }): Promise<T>;
  ```

- **Before / after.** `rehearsal/material.ts`: 4 lines become
  `const record = await studioJson<{ value: Draft }>(artifactPath(workspaceId, choice.ref))`.
- **Lines.** About 260 removed, 30 added.
- **Cannot get wrong any more.** A forgotten `ok` check; a forgotten tenant header (it sits on
  `studioFetch`); an error that loses the server's code; a missing `content-type`.
- **Risk.** Low. Callers that branch on `response.status` (409 conflicts in the workspace draft)
  read `error.status` instead; convert those with their tests.
- **Tests.** Extend `studio-requests.test.tsx`: header set, JSON body, `error.code` carried,
  non-JSON error body, abort passes through.
- **Held by.** The forms-onto-DynamicForm workers hold several of the caller files; the helper
  itself is one existing file. Bare `fetch(` in `behaviour-flags-setting.tsx`,
  `use-studio-lists.ts`, `use-account.ts` and `coach-notes.tsx` (5 calls) move to it too, unless one
  leaves the tenant header out on purpose (not checked).

### WO-4: one engine request scope (`asking`)

- **Repeated shape.** `{ scope: { ...scope, productId: INTERVIEW_PRODUCT_ID }, permissions:
  ["interview.read", ...], signal, ...(for ? { for } : {}) }` as the second argument of every
  engine call.
- **Sites (10 in 9 files).** `context-pack/prepare.ts` (2), `context-pack/pack.ts`,
  `context-pack/readers.ts` (has a local `asking`), `context-pack/routes.ts` (has another local
  `asking`), `documents/generate.ts`, `documents/cast.ts`, `documents/api.ts`, `coach/coach.ts`,
  `live-session/engine-call.ts`.
- **Surface.** New file `products/interview/src/backend/engine-asking.ts`:

  ```ts
  export type Asker = { tenantId: string; actorId: string };
  export function asking(who: Asker, access: "read" | "write", signal: AbortSignal, about?: EngineSubject):
    { scope: EngineScope; permissions: readonly string[]; signal: AbortSignal; for?: EngineSubject };
  ```

  `"read"` is `["interview.read"]`; `"write"` adds `"interview.documents.write"`. Two values, not
  a list the caller composes.
- **Before / after.** Six lines per call become `asking(execution.scope, "write", execution.signal,
  { kind: "candidacy", id })`.
- **Lines.** About 55 removed, 20 added.
- **Cannot get wrong any more.** A call with no cancellation signal; a call with another product's
  id; a permission string typed wrongly (they are strings today).
- **Risk.** Low. `coach/coach.ts` spreads extra fields (`policy`, `conversation`,
  `idempotencyKey`) after it; that stays as a spread.
- **Tests.** One unit test for the two access levels; the existing engine-call tests cover the
  rest unchanged.
- **Held by.** The services worker for `documents/` and `context-pack/`; the file is new.

### WO-5: shared test timers and scope builders

- **Repeated shape.** `const flush = () => act(() => vi.advanceTimersByTimeAsync(0))`,
  `const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms))`,
  `const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)))`,
  `const scopeOf = (person) => ({ tenantId: tenant, actorId: person.id })`.
- **Sites.** `flush` in 35 test files (two bodies: the React one and a `setImmediate` one),
  `advance` in 20, `settle` in 14, `scopeOf` in 11, `installServer` in 8.
- **Surface.** New file `products/interview/src/frontend/studio/testing/timers.ts`
  (`flush`, `advance`, `settle`) and, for the backend,
  `products/interview/src/backend/testing/flush.ts` (`flush` on `setImmediate`). `scopeOf` joins
  the existing `live-session/live-session-fixture.ts`, which already provisions the people.
- **Lines.** About 85 removed, 15 added.
- **Cannot get wrong any more.** A `flush` outside `act` (the usual cause of a flaky React test).
- **Risk.** None to production. `installServer` is NOT in this order: the 8 copies stub different
  routes; see "Later".
- **Tests.** The suites that use them.
- **Held by.** Test files across every directory; import-only edits, safe to do last in each
  worker's own commit.

### WO-6: guard tests use `guard-support`

- **Repeated shape.** `function repoRoot(from) { walk up to pnpm-workspace.yaml }` and a
  `readdirSync` walk with its own ignore list.
- **Sites.** `repoRoot` defined in 7 test files (`scripts/package-boundaries.test.ts`,
  `raw-sql-guard.test.ts`, `rls-role-guard.test.ts`, `tenant-context-boundary.test.ts`,
  `tenant-slug-parity.test.ts`, and two frontend parity tests); 5 guard tests walk files without
  `scripts/guard-support.ts`, which already exports `repoRoot`, `walk`, `sourcePattern`, `parse`
  and `importSites`. 12 of 28 guard tests use it.
- **Surface.** None new. This is an under-used helper.
- **Lines.** About 110 removed, 0 added.
- **Cannot get wrong any more.** A guard that walks `dist` or misses `.mts`, so two guards
  disagree about what "all source" is.
- **Risk.** A guard that silently covers fewer files after the change. Each conversion asserts the
  number of files visited before and after.
- **Held by.** `scripts/` only; nobody else.

### WO-7: the coach scripts share one API preamble

- **Repeated shape.** `const base = (process.env.INTERVIEW_API_URL ?? "http://127.0.0.1:3000")...;
  function token() { env or read .dev-local/api-token or "" }; fetch with bearer`.
- **Sites (3 of 3).** `scripts/coach-note.mjs`, `scripts/coach-plan.mjs`,
  `scripts/coach-transcript.mjs`. The same two variables are read again in
  `packages/interview-cli` and `apps/agent-worker/src/coach-loop.ts`.
- **Surface.** New file `scripts/coach-api.mjs`:

  ```js
  export async function coachApi(method, path, body) // -> parsed JSON; throws with the status and the server's code
  ```

- **Against principle 7.** All three fall back silently to `127.0.0.1:3000` and to an empty token.
  The helper should say which address and which token source it used when a call fails, and refuse
  an empty token with one sentence naming `.dev-local/api-token`.
- **Lines.** About 50 removed, 30 added.
- **Risk.** Low; the `live-coach` skill calls these by name, so file names and arguments stay.
- **Tests.** `scripts/coach-api.test.ts`: token from the environment, from the file, absent.
- **Held by.** `scripts/` only.

### WO-8: one flag reader for the benchmark and replay scripts

- **Repeated shape.** `const args = process.argv.slice(2); const one = (flag) => args[args.lastIndexOf(flag)+1];
  const has = ...; const list = ...`, then `Number(one("--x") ?? 3)` at each use.
- **Sites (4).** `scripts/pack-eval.ts`, `scripts/pack-bench.ts`,
  `apps/agent-worker/src/coach-replay.ts` (with a hand `VALUED` set),
  `scripts/coach-transcript.mjs`. `node:util` `parseArgs` is used nowhere.
- **Surface.** Use the platform: `parseArgs({ options: { model: { type: "string" }, ... }, strict: true })`
  declared once at the top of each script. No new file. A flag becomes one data entry and an
  unknown flag is an error instead of being ignored (today `--modle x` runs with the default).
- **Lines.** About 40 removed, 30 added: a small saving; the win is the refused typo, and the
  header comment listing flags in `pack-eval.ts` stops being able to drift from the code.
- **Risk.** `pnpm pack:eval -- --flag` argument forwarding; check each `package.json` script once.
- **Held by.** `scripts/` and `apps/agent-worker/src/coach-replay.ts` (the benchmark worker, if
  one is on coach replay today).

### WO-9: one place for clock and relative-time text

- **Repeated shape.** `const clock = (seconds) => mm:ss`, `relativeTime(iso, now)`, `clockTime(at)`.
- **Sites.** `clock` in `documents/document-writing.tsx`, `documents/new-document-dialog.tsx`,
  `rehearsal/config.ts`, `live/overlay/panels/panel-model.ts`; relative time in
  `format-timestamp.ts` (`formatRelativeTime`), `documents/documents-model.ts` (`relativeTime`),
  `live/banner-copy.ts` (`ago`); wall-clock time in `live/overlay/panels/answer-meta.ts`
  (`clockTime`), `live/shared/use-screenshots-view.ts` (`timeLabel`), `live/session-format.ts`
  (`clockLabel`), `live/ended-summary.ts` (`formatDayTime`).
- **Surface.** The existing `products/interview/src/frontend/format-timestamp.ts` gains
  `formatClock(seconds)`, and the duplicates import it and `formatRelativeTime`. Read each pair
  first: where two differ in output ("just now" against "0 seconds ago"), pick one and say so in
  the commit, because that is a visible change.
- **Lines.** About 60 removed, 10 added.
- **Cannot get wrong any more.** Two screens showing the same moment in two formats.
- **Risk.** Low; visible text may change in one or two places.
- **Tests.** Extend `format-timestamp.test.ts`.
- **Held by.** `documents/` and `live/overlay/` frontend files (the forms workers); import-only.

### WO-10: remembered preferences through one stored-value helper

- **Repeated shape.** `try { const v = window.localStorage.getItem(key); return v === "a" || v ===
  "b" ? v : fallback } catch { return fallback }`, and the mirror for writing.
- **Sites.** Web storage is touched 76 times in 27 Interview frontend files, each with its own
  try/catch: `live/overlay/auto-prefs.ts`, `capture-prefs.ts`, `auto-owner-pause.ts`,
  `panels/tests-drawer-pref.ts`, `panels/panel-glass.ts`, `panels/coach-columns.tsx` (11),
  `documents/creation-mode.ts`, `briefings/behavioural/matrix-picker.tsx`,
  `live/hands-free-choice.ts`, `resizer.tsx`, and more. Presentation solved it once:
  `products/presentation/src/frontend/safe-storage.ts`.
- **Surface.** New file `products/interview/src/frontend/studio/shared/stored.ts`:

  ```ts
  export function stored<T extends string>(key: string, allowed: readonly T[], fallback: T):
    { read(): T; write(value: T): void; clear(): void };
  ```

  One function; a boolean preference is `stored(key, ["on", "off"], "off")`.
- **Before / after.** `creation-mode.ts`: 16 lines become
  `export const creationMode = stored("…creation-mode", ["ai", "manual"], "ai")`.
- **Lines.** About 170 removed, 35 added (estimate from reading 6 of the 27 files).
- **Cannot get wrong any more.** A screen that breaks in a private window; a stored value outside
  the allowed set reaching the app.
- **Risk.** Low. Keys are unchanged, so nobody loses a preference.
- **Tests.** `stored.test.ts`: storage that throws, an unknown stored value, round trip.
- **Held by.** `live/overlay/` (the forms workers). A preference is a candidate for the library
  later; see "Between the two products".

## Part 2: the fuller list by category

Verdicts: DO NOW, WITH THE REFACTOR (belongs inside a boundary refactor in flight), LATER (one real
site today), DO NOT.

### 1. Transport

| Name | Shape | Sites | Proposal | Verdict |
|---|---|---|---|---|
| Bounded body | read, bound, parse | 4 copies | WO-1 | DO NOW |
| Route failures | parse, call, map errors | 5 wrappers, 245 routes | WO-2 | DO NOW |
| Scoped work | `const scoped = (c, work) => withTenant(c.get("documentScope"), work, { database })` | `brief/routes.ts`, `context-pack/routes.ts`, inline in `documents/api.ts` | disappears when routes call services that take a scope; do not add a transport helper for it | WITH THE REFACTOR |
| Same-origin check for writes | compare `origin` with `host`, refuse `sec-fetch-site: cross-site` | written in `documents/api.ts` middleware; check `apps/web/src/platform/api-safety.ts` for the second copy before acting | one `sameOrigin(request)` in the shell's safety module | LATER (confirm the second site) |
| Page numbers | `pageNumber(value, fallback)` | 1 (`live-session/routes.ts`) | none | DO NOT (one site) |
| Retry keys | `retryKeyOf(request)` + `bindingHash(parts)` | 1 module (`documents/api.ts`); "idempotency" appears in 20 files but with different meanings | none yet; when a second API needs it, lift `retryKeyOf` whole, binding tenant, operation and payload as his rule says | LATER |
| Stream of events | `postStream` / `readNdjson` | one writer, one reader | already single | DO NOT |

### 2. Services and use cases

| Name | Shape | Sites | Proposal | Verdict |
|---|---|---|---|---|
| Result or failure | three styles in use: `{ ok: false, reason }` (58 sites in 15 files), thrown error classes with a `code` (`BriefError`, the `Document*` errors), and the engine's `{ ok, failure }` | whole backend | no helper; a RULE: a service returns `{ ok: false, code }` for an expected refusal and throws only for a defect; WO-2's `codes` map answers both during the migration | WITH THE REFACTOR |
| Engine failure handling | `if (!result.ok) { if (cancelled or signal.aborted) throw Cancelled; throw new XError(result.failure.reason) }` | `context-pack/prepare.ts` (2), `context-pack/pack.ts`, `documents/cast.ts`, `documents/generate.ts` | `valueOrThrow(result, signal, (reason) => new ContextPackError(reason))` beside WO-4: 5 sites, about 25 lines | DO NOW (small; ride with WO-4) |
| Options bags | `createDocumentsApi(options)` mixes database, engine, local-development loaders, config and pack options (11 fields); `IngestOptions` the same | 2 known | split into `{ deps, config }` only as each module is cut into a service | WITH THE REFACTOR |
| Organiser / action helper (light-service style) | authorise, load, decide, persist, publish | every use case | see "Do not" | DO NOT |
| In-flight guard | `createInFlight()` | shared in `work-guards.ts`, 3 backend users | already single | none |

### 3. Repositories

Left to the repositories workers; this audit only counted. `withTenant(` 21 sites,
`tenantTransaction(` 31, hand `eq(x.tenantId, …)` predicates 58 in 5 files, upserts 5, row mapper
functions 4. The low mapper count against 58 hand predicates says rows are mapped inline and the
tenant predicate is typed out beside row-level security.

| Name | Proposal | Verdict |
|---|---|---|
| Key predicate | per repository, one private `const mine = (scope, id) => and(eq(t.tenantId, scope.tenantId), eq(t.id, id))`; not a cross-repository generic | WITH THE REFACTOR |
| Compare-and-swap on a revision | 1 confirmed owner (`InterviewDocumentRepository`), Presentation has its own on `revision` | DO NOT share: two tables, two protocols, and the owner's note says never to weaken it |
| Generic base repository / `crud(table)` | none | DO NOT (a base class, and Drizzle is already the query language) |

### 4. Contracts

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Frontend re-declares server shapes | `documents/documents-client.ts` declares `Template`, `DocumentListItem`, `DocumentDetail`, `DocumentReview` by hand (about 100 lines) while importing only field types from `@omnitech/interview-contracts` | move the response schemas to the contracts package and `z.infer` both sides | WITH THE REFACTOR (document editor slice) |
| `const uuid = z.uuid()` | `documents/api.ts`, `brief/routes.ts`, `context-pack/routes.ts` | folded into WO-2 `param()` | DO NOW |
| Hand JSON Schema beside zod | `briefJsonSchema()` in `documents/api.ts` (not read in full) | derive with `z.toJSONSchema` if it is hand-kept | LATER (confirm) |
| `as T` on responses | every frontend `response.json() as T` | WO-3 keeps `as T`; parsing every response with zod is cost with no second need today | DO NOT (yet) |

### 5. Frontend

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| JSON calls | 64 / 42 | WO-3 | DO NOW |
| Stored preferences | 76 in 27 files | WO-10 | DO NOW |
| Formatters | 12 functions | WO-9 | DO NOW |
| Load, error, busy state | error and loading setters 118 in 21 files; hooks such as `use-plan.ts`, `use-studio-lists.ts`, `use-canonical-draft.ts`, `use-account.ts` each hold `data / error / loading` and an aborting effect | `useLoad(key, load)` returning `{ data, error, reload }` on `studioFetchUntil`, about 40 lines; first confirm 3 hooks reduce to it without a flag | LATER, after WO-3 (then it is nearly free) |
| Presentation's one file | `products/presentation/src/frontend/index.tsx`: 2,639 lines, 28 `fetch(`, 16 JSON header blocks, local `json` / `ok` helpers | a `presentation-client.ts` with one `send(tenantSlug, method, path, body?)` and named calls; about 110 lines removed | WITH THE REFACTOR (library migration of Presentation) |
| Forms | 79 raw inputs in 28 files; `DynamicForm` 2 uses | owned by BRIEF-web-app-on-the-ui-library-only | WITH THE REFACTOR |
| Clipboard with "copied" state | 5 uses in 3 files; Presentation has `copy-text.ts` | none in Interview yet | LATER |
| Confirm dialogs | 5 uses in 4 files | library `Modal` confirm option when the screens migrate | WITH THE REFACTOR |

### 6. AI and context

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Request scope | 10 in 9 files | WO-4 | DO NOW |
| Failure to exception | 5 | with WO-4 | DO NOW |
| Default profile literal | `"agent/claude-code"` as `BRIEF_PROFILE` in `documents/api.ts` and `DEFAULT_PACK_PROFILE` in `context-pack/routes.ts` | one exported constant in `assistant-profile.ts` | DO NOW (two lines; ride with WO-4) |
| Benchmark harness | `scripts/pack-eval.ts` (799 lines), `pack-bench.ts` (398), `benchmark-document-groups.ts` (179), `apps/agent-worker/src/coach-replay.ts` (1,640): each parses flags, resolves a repository-root path and writes a results file | flags by WO-8; result writing has one real implementation (`pack-eval.ts`), so no helper | LATER for results; DO NOW for flags |

### 7. Workers and loops

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Tick loop | `session-loop.ts` (`runSessionLoop`: tick, sleep when idle, exponential back-off, log the error's name) and `coach-loop.ts` (tick, `abortableSleep(300)`, its own failure handling) | `runTickLoop({ tick, signal, idleMs, log })` in `session-loop.ts`, used by both; about 30 lines | LATER: two sites, but the coach loop also waits on a lease; convert only if the lease wait fits as `tick` returning false |
| Abortable sleep | `abortableSleep` is exported and reused; 7 other `sleep` / `delay` definitions across apps, scripts and e2e | reuse where the caller has a signal | LATER |
| Signal handling | `process.on(` once outside tests | nothing to share | DO NOT |

### 8. Configuration and environment

133 reads in 52 files, but only 6 carry an inline default and 4 parse by hand; the existing
inventory (`scripts/env-reads.ts`, `scripts/env-docs.test.ts`) already ratchets documentation.

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Coach API address and token | `INTERVIEW_API_URL` and `INTERVIEW_API_TOKEN` each read in 3 places with a silent default | WO-7 | DO NOW |
| Shell configuration | `apps/web/src/platform/ai.ts` (12 reads), `auth.ts` (9), `products.ts` (8), `fake-auth.ts` (7) | they are the shell's composition root; a typed `config.ts` would move 36 reads into one file and delete nothing | DO NOT (no lines saved; revisit if a variable is read twice) |
| Inline defaults | 6 | extend `env-docs.test.ts` to list any read with `??` or `||` on an allow-list that may only shrink | DO NOW (tripwire only) |

### 9. Logging and errors

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Error classes | 53 classes in 35 files; many are `class X extends Error { name = "X" }` with nothing else, existing only to be matched by `instanceof` in a route | no base class; as services return `{ ok: false, code }` the marker classes go, and WO-2's `codes` map replaces the `instanceof` chains | WITH THE REFACTOR |
| Failure logging | Presentation's `logFailure(route, error)` (metadata only) is the right shape and is private to one file; `console.*` appears 68 times in 16 backend and package files | WO-2 `log` uses the logging package once | DO NOW (inside WO-2) |

### 10. Tests and fixtures

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Timers | 35 / 20 / 14 files | WO-5 | DO NOW |
| `scopeOf` | 11 | WO-5 | DO NOW |
| Guard file walking | 7 + 5 | WO-6 | DO NOW |
| `installServer` (stub `fetch` with a route table) | 8 test files, different routes each | a `stubStudioApi({ "GET /path": reply })` beside `live/testing/session-test-server.ts`, which already does this for sessions | LATER: read all 8 first; if only the route table differs, about 150 lines go |
| `vi.mock("@/auth")` | 9 files in `apps/web` | a `__mocks__` file or a `mockAuth(session)` helper | LATER (not read) |
| Screen stubs | `vi.mock("../rehearsal/rehearsal-view")` 6, `../workspace/workspace-view` 5, `../home/home-view` 5 | one `mockStudioViews()` in the studio test kit | LATER (not read) |
| Worlds | `live-session/hardening/world.ts`, `memory-session-world.ts`, `live-session-fixture.ts`, `processor-fixture.ts` are already shared; `world` is also a local name in 14 test files | not confirmed as duplication | not read |

### 11. Scripts and tooling

| Name | Sites | Proposal | Verdict |
|---|---|---|---|
| Flags | 4 | WO-8 | DO NOW |
| Coach API preamble | 3 | WO-7 | DO NOW |
| Repository-root path | `fileURLToPath(new URL("../", import.meta.url))` in `pack-eval.ts` and `pack-bench.ts`; `repoRoot` in `guard-support.ts` | import `repoRoot` | DO NOW (inside WO-6) |

### 12. Between the two products, and between a product and a package

| Duplicate | Interview | Presentation | Where it belongs | Verdict |
|---|---|---|---|---|
| Route failures table | 4 local wrappers | `route(FAILURES.x)` | a product may not import the other; the neutral home is `@omnitech/platform-api` (it already owns the router). That is a package other workers hold, so WO-2 starts inside Interview and Presentation's copy moves when the package is free | LATER (the move), DO NOW (Interview) |
| Safe browser storage | 27 files by hand | `safe-storage.ts` | the UI library (a hook), library first | LATER; WO-10 is the Interview stopgap |
| Copy to clipboard | 3 files | `copy-text.ts` | the UI library | LATER |
| Tenant header on fetch | `studio-fetch.ts` | `api(tenantSlug, path)` puts the tenant in the path | different by design (rule 4 routes) | DO NOT |

## Existing abstractions that are under-used

| Helper | Where | Uses it | Still by hand |
|---|---|---|---|
| `readBoundedJson` | `packages/platform-contracts/src/bounded-json.ts` | 3 files | 4 files, 8 functions (WO-1) |
| `scripts/guard-support.ts` (`repoRoot`, `walk`, `parse`, `importSites`) | `scripts/` | 12 of 28 guard tests | 7 `repoRoot` copies, 5 own walkers (WO-6) |
| `checked` / `documentJson` / `postJson` | `documents/documents-client.ts` | documents only | about 40 frontend files (WO-3) |
| `formatRelativeTime` | `frontend/format-timestamp.ts` | few | 2 other relative-time functions (WO-9) |
| `studioFetch` | `studio/studio-fetch.ts` | 16 files | 5 bare `fetch(` calls in 4 Interview files (`behaviour-flags-setting.tsx`, `use-studio-lists.ts`, `use-account.ts`, `coach-notes.tsx`); whether each leaves the tenant header out on purpose was not checked |
| Presentation's `Failures` table | `presentation/src/backend/api.ts` | Presentation's routes | every Interview route (WO-2) |
| `abortableSleep` | `apps/agent-worker/src/session-loop.ts` | 3 loops | 7 other sleep helpers (not all have a signal) |
| Local `asking()` | `context-pack/readers.ts`, `context-pack/routes.ts` | 2 files, each its own | 7 other files (WO-4) |

## Existing abstractions to delete or flatten

Read lightly; each needs a second look before removal.

| What | Why | Action |
|---|---|---|
| `readBody` in `backend/api.ts` | wraps `readBoundedJson` only to turn a refusal into a response; WO-1 and WO-2 make it a throw answered by the table | delete with WO-2 |
| `jsonBody` in four route files | one-line forwarders to the local bounded reader | delete with WO-1 |
| `host: Hono<any>` cast with a `biome-ignore` in `brief/routes.ts` and `context-pack/routes.ts` | both register onto the documents app and re-type it by hand | one exported `DocumentsApp` type from `documents/api.ts`; removes 2 lint suppressions |
| `createDocumentsApi` options `packs`, `packProfile`, `loadMatrix` | passed straight through to `registerPackRoutes` | pass one `pack: PackRoutesOptions` object, or register pack routes from the composition root |
| Marker error classes (`class X extends Error` with only a name) | exist to be caught one layer up | go as services return typed failures |
| `sleep?:` and `log?:` options on the worker loops | passed only by tests | keep: an injected clock in a test is a real second implementation |

## Do not

| Looks like repetition | Why it stays |
|---|---|
| A use-case organiser (`organize(authorize, load, decide, persist, publish)`) in the light-service style | In TypeScript the steps differ in type at every use case, so the helper becomes generics over a context bag and the reader loses the top-to-bottom function. His own note calls a declarative list of business steps "a second programming language". A service is a function that reads top to bottom; `tenantTransaction` already hides the one cross-cutting part. Revisit only if three services share the same steps with the same types. |
| A generic repository or `crud(table)` | A base class with one behaviour per table; Drizzle is already the abstraction. |
| A typed `config` module for the shell | Moves 36 reads and removes none; the documentation tripwire already exists. |
| One compare-and-swap helper for documents and presentations | Two protocols that must each stay atomic; sharing invites a read-then-write. |
| Zod-parsing every response in the frontend | No second need today; the contract move (category 4) gives the types without the runtime cost. |
| A shared `FAILURES` across products now | Needs a package change while packages are held; do it once, later. |
| Merging the fixtures under `live-session/*fixture*.ts` | They are data for different scenarios, not copies of one shape. |
| A `useForm` or field-state hook | `DynamicForm` is the answer and its migration is in flight. |

## The top fifteen

| # | Opportunity | Verdict | Sites | Lines removed / added (estimate) | Mistake it prevents |
|---|---|---|---|---|---|
| 1 | Route failures table and `input()` (WO-2) | DO NOW | 5 wrappers, about 60 routes at first | 380 / 110 | unmapped error, leaked message, missing size limit |
| 2 | `studioJson` (WO-3) | DO NOW | 40 files | 260 / 30 | missing `ok` check, tenant header, lost error code |
| 3 | Stored preferences (WO-10) | DO NOW | 27 files | 170 / 35 | crash in a private window, invalid stored value |
| 4 | Guard tests on `guard-support` (WO-6) | DO NOW | 12 files | 110 / 0 | guards disagreeing about what source is |
| 5 | Bounded body reader (WO-1) | DO NOW | 4 files | 95 / 45 | unbounded read (one exists today) |
| 6 | Test timers and scopes (WO-5) | DO NOW | 35 files | 85 / 15 | flush outside `act` |
| 7 | Formatters (WO-9) | DO NOW | 11 functions | 60 / 10 | one moment shown two ways |
| 8 | Engine `asking()` and failure to exception (WO-4) | DO NOW | 10 + 5 | 80 / 30 | call without a signal, wrong permission string |
| 9 | Coach scripts API (WO-7) | DO NOW | 3 files | 50 / 30 | silent default address and empty token |
| 10 | Script flags on `parseArgs` (WO-8) | DO NOW | 4 files | 40 / 30 | a mistyped flag ignored |
| 11 | Presentation client | WITH THE REFACTOR | 28 calls | 110 / 40 | as 2 |
| 12 | Contracts for document responses | WITH THE REFACTOR | 1 file, 100 lines | 100 / 60 | client and server shapes drifting |
| 13 | `stubStudioApi` for tests | LATER | 8 files | 150 / 40 | not confirmed |
| 14 | `useLoad` | LATER | 4 hooks named | 80 / 40 | stale response overwriting a newer one |
| 15 | One result style for services | WITH THE REFACTOR | 58 + 53 | about 53 marker classes over time | an expected refusal thrown as a defect |

Total for the ten DO NOW orders: about 1,330 lines removed for about 335 added.

## Order of work and file ownership

No two orders share a new file. Call-site conversion is the only place they meet other workers.

| Step | Order | New or edited helper file (owner: this order only) | Call sites belong to | Can start |
|---|---|---|---|---|
| 1 | WO-6 | none (`scripts/guard-support.ts` read only) | `scripts/*.test.ts` | now |
| 1 | WO-7 | `scripts/coach-api.mjs` | `scripts/coach-*.mjs` | now |
| 1 | WO-8 | none | `scripts/pack-*.ts`, `coach-replay.ts` | now |
| 1 | WO-5 | `frontend/studio/testing/timers.ts`, `backend/testing/flush.ts` | test files everywhere (imports only) | now; convert per directory |
| 1 | WO-1 | `backend/transport/body.ts` | route files | helper now; sites after the route owners land |
| 2 | WO-2 | `backend/transport/route.ts` | route files, `backend/api.ts` last | after WO-1 |
| 1 | WO-4 | `backend/engine-asking.ts` | `documents/`, `context-pack/`, `coach/`, `live-session/engine-call.ts` | helper now; sites with the services workers |
| 1 | WO-3 | `frontend/studio/studio-fetch.ts` (one existing file) | Studio frontend | helper now; sites per screen |
| 2 | WO-9 | `frontend/format-timestamp.ts` | `documents/`, `live/` frontend | any time |
| 2 | WO-10 | `frontend/studio/shared/stored.ts` | `live/overlay/`, `documents/` frontend | any time |

Each order lands as: the helper with its tests; then conversions one directory at a time, each
with that directory's existing tests green and no change to a response body.

## Tripwires, in the ratchet-with-allow-list style

Each is a test under `scripts/` using `guard-support`, with an allow-list of today's offenders that
may only shrink (the pattern of `scripts/application-boundaries.ts`).

| Order | The check fails when |
|---|---|
| WO-1 | a backend file outside `transport/body.ts` and `platform-contracts` calls `.getReader()` on a request, `request.text()`, `c.req.json()` or `request.json()` |
| WO-2 | a route file contains `.safeParse(` followed by a literal 4xx response, or `app.onError` with `instanceof`; a registration is not wrapped in `handle(` |
| WO-3 | a file under `frontend/studio/` outside `studio-fetch.ts` calls bare `fetch(` or reads `response.ok` |
| WO-4 | a backend file outside `engine-asking.ts` contains `productId: INTERVIEW_PRODUCT_ID` next to `permissions: [` |
| WO-5 | a test file defines `const flush`, `const advance` or `const settle` |
| WO-6 | a file under `scripts/` defines `repoRoot` or calls `readdirSync` outside `guard-support.ts` |
| WO-7, WO-8 | a script reads `INTERVIEW_API_URL` outside `coach-api.mjs`; a script indexes `process.argv` by hand |
| WO-9 | a frontend file outside `format-timestamp.ts` constructs `Intl.RelativeTimeFormat` or defines `clock` |
| WO-10 | a frontend file outside `stored.ts` touches `localStorage` or `sessionStorage` |
| Environment | a `process.env.X ?? "…"` or `|| "…"` appears outside the allow-list (extension of `env-docs.test.ts`) |

## What was not read

- A second, deeper pass over the backend (services, repositories, contracts, error classes) was
  still running when this brief was written; its counts are not in this document.

- Repositories in any depth: counted only; that work is in flight.
- `live-session/` internals (ingest, processor, fenced writes), `coach/coach.ts` beyond its engine
  call, and `documents/generate.ts` beyond its engine call.
- Prompt assembly: whether prompt sections and JSON-instruction footers repeat was not examined.
- `apps/web` route handlers (native sign-in, integrations) and `apps/terminal-gateway`,
  `apps/capture-companion`, `apps/studio-shell`.
- The Swift host: no Swift file was opened; parity with TypeScript declarations is unaudited
  beyond noting that `scripts/tenant-slug-parity.test.ts` and
  `live/host-capability-parity.test.ts` exist.
- The e2e harness (`e2e/live-session`, 16,000 lines).
- `packages/interview-cli`, `interview-api-client`, `interview-storage`, `platform-storage`,
  `platform-integrations`, `code-runner`.
- The 8 `installServer` copies, the `vi.mock` factories, and the 14 local `world` builders were
  counted, not compared.
- Frontend component composition (lists, tables, empty states, toolbars): left to
  BRIEF-web-app-on-the-ui-library-only, which already counts it.
