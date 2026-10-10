# DRY helper conversion handoff

Created 2026-10-10. Helpers only: **no call site was converted**. Paths below were read in the
shared checkout; recheck their names after the directory owners finish. There is no worktree,
commit, push, browser run or full gate in this order. Use a typed client for frontend requests;
move a request out of a view into its existing client/controller before replacing it.

## Helper entry points and decisions

- Backend: `products/interview/src/backend/index.ts` exports `readBytes`, `readJson`,
  `readUpload`, `BodyRefused`, `handle`, `input`, `param`, `asking`, `valueOrThrow` and their types.
- Frontend: `products/interview/src/frontend/index.ts` exports `studioJson`,
  `StudioRequestError`, `stored`, `formatClock`, `formatRelativeTime`, `formatTimestamp`.
- Internal frontend modules are `studio/studio-json.ts`, `studio/shared/stored.ts` and
  `format-time.ts`. The latter re-exports the existing relative/absolute formatters, with no
  second implementation. New files override the brief's proposed edits to existing helpers.
- `handle` keeps the specified narrow `Failures` surface and emits `{ error: { code } }`.
  Known/class and configured-code rows take precedence over the built-in BodyRefused/Zod rows.
  Unknown errors log the constructor name and configured route only; no message, stack or payload.
  **The brief contradicts itself:** its wire-format paragraph asks for a renderer argument but
  its exact `Failures` signature has none. This order preserves the requested signature.
  v1 and live-session conversions therefore need an outer transport renderer that preserves
  their existing contract; do not directly adopt the code-only responses there.
- `valueOrThrow` unwraps the engine's actual `value`, `prepared` and `resolved` payloads.
  Cancelled results or an aborted signal throw `DOMException` with `name: "AbortError"`;
  translate it at a caller that promises a product-specific cancellation class.
- `formatClock` is a **duration in seconds**, clamps negative values, rounds like Rehearsal,
  and returns `""` for non-finite input. Existing document timers use integral seconds;
  fractional seconds will now round. Relative text uses the existing full words and floor
  thresholds, rather than Documents' abbreviated words and rounded thresholds.
- `stored` is **localStorage, finite string choices only**. It intentionally does not promise
  JSON, numeric, sessionStorage, or write-failure callbacks. Keys stay exactly as they are.

## `products/interview/src/backend/brief/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `routes.ts` / local `route` | `const route = (work: (c: ScopedContext) => Promise<Response>) => handle<ScopedContext>({ codes: STATUS }, work);` | Keep membership/service scope outside the helper. |
| `routes.ts` / local `id` | `const id = (c: ScopedContext, name = "id") => param(c, name);` | UUID parsing. |
| `routes.ts` / `jsonBody(request, limit)` | `const body = await readJson(request, limit);` | Retain SMALL_JSON default at the caller. |
| `routes.ts` / `boundedBody(request, limit)` | `const bytes = await readBytes(request, limit);` | Translate BodyRefused where a caller promises BriefError. |
| `routes.ts` / `fileBody` reader | `const { file, form } = await readUpload(request, limit + FORM_OVERHEAD, "file");` | Keep file.size <= limit, name, field trimming and Uint8Array return. |
| `routes.ts` / schema parse of jsonBody | `const body = await input(c, schema, limit);` | Substitute the existing schema and limit of each registration; do not change contracts. |

## `products/interview/src/backend/context-pack/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `routes.ts` / boundedJson and packPrepareSchema parse | `const body = await input(c, packPrepareSchema, SMALL_JSON);` | Current blank input becomes {}; readJson refuses blank input. Preserve the legacy blank case explicitly if request tests require it. |
| `routes.ts` / boundedJson and packCorrectionsSchema parse | `const body = await input(c, packCorrectionsSchema, SMALL_JSON);` | Bound before buffering, same blank-input note. |
| `routes.ts` / UUID parsing | `const candidacyId = param(c, "id");` | Keep existing names in each handler. |
| `routes.ts` / local asking | `const execution = asking(scope, "write", signal, about);` | Pass the request's actual signal; current profile-only calls have no signal. |
| `prepare.ts` / prepare execution | `asking(execution.scope, "write", execution.signal, { kind: "candidacy", id: input.candidacyId })` | Keep prepare input, recipe and progress unchanged. |
| `prepare.ts` / correct execution | `asking(execution.scope, "write", execution.signal, { kind: "candidacy", id: input.candidacyId })` | Same correction payload. |
| `prepare.ts` / prepare failure branch | `const preparedValue = valueOrThrow(result, execution.signal, (reason) => new ContextPackError(reason));` | Map AbortError to PackPreparationCancelled; replace later result.prepared reads with preparedValue. |
| `prepare.ts` / correct failure and return | `return valueOrThrow(result, execution.signal, (reason) => new ContextPackError(reason));` | Cancellation mapping at the service boundary. |
| `pack.ts` / prepare execution | `asking(execution.scope, "read", execution.signal, execution.for)` | Read-only permissions. |
| `pack.ts` / prepare failure branch | `const preparedValue = valueOrThrow(result, execution.signal, (reason) => new ContextPackError(reason));` | Keep kept/withheld merge; use preparedValue downstream. |
| `pack.ts` / resolved failure branch | `const resolvedValue = valueOrThrow(resolved, execution.signal, (reason) => new ContextPackError(reason));` | Keep projection and selection; use resolvedValue downstream. |
| `readers.ts` / local asking used by find/related | `const request = asking(execution.scope, "read", execution.signal, execution.for);` | Replace every local asking(execution) argument with request; identical subject. |

## `products/interview/src/backend/documents/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `api.ts` / jsonBody | `const body = await readJson(request, MAX_JSON);` | Keep SyntaxError/RequestTooLarge response codes through explicit BodyRefused mapping. |
| `api.ts` / boundedBody | `const bytes = await readBytes(request, limit);` | All reads share the streamed bound. |
| `api.ts` / upload reader | `const { file, form } = await readUpload(request, MAX_UPLOAD + MAX_JSON, "file");` | Keep non-empty file, MAX_UPLOAD, formText and Buffer conversion. |
| `api.ts` / hand UUID safeParse guards | `const id = param(c, "id");` | Substitute the original param name; map invalid UUID to the original code. |
| `api.ts` / app.onError class chain | `handle(DOCUMENT_FAILURES, work)` | Put every existing class/status/code pair in DOCUMENT_FAILURES; do not infer a code from its class name. |
| `api.ts` / JSON safeParse registrations | `const body = await input(c, schema, MAX_JSON);` | The owning route supplies its actual contract and existing fixed invalid-input code. |
| `api.ts` / local asking used by profiles | `asking(scope, "write", signal)` | Obtain signal from the route; do not manufacture an uncancellable one. |
| `generate.ts` / generate execution | `{ ...asking(input, "write", signal, input.for), ...input.request }` | Preserve trusted request metadata; retain original subject-overrides-request ordering if request carries for. |
| `generate.ts` / terminal retry failure branch | `valueOrThrow(generated, signal, () => new DocumentModelFailure(generated.failure))` | Use inside the existing !generated.ok terminal branch; retain full Failure, retryability, attempts and success usage. Do not unwrap before retry decisions. |
| `cast.ts` / ranking execution | `{ ...asking(input, "write", input.signal), ...input.request }` | Same request metadata. |

`cast.ts` is **not** a failure-to-exception conversion: unavailable ranking deliberately returns
`planCast(..., { order: [], by: "unavailable" })`. Retain that fallback. A cancelled signal can
use valueOrThrow and then translate AbortError to its existing cancellation exception.

## `products/interview/src/backend/live-session/` and `coach/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `live-session/routes.ts` / boundedBytes, including its clone, image and audio callers | `const bytes = await readBytes(request, limit);` | Current absent body returns empty bytes; preserve that case outside readBytes if required. Map BodyRefused to BodyTooLarge/SessionError. |
| `live-session/routes.ts` / jsonBody | `const body = await readJson(request, MAX_JSON_BYTES);` | Map invalid-request to invalid_input and retain existing live error envelope/refusal headers. |
| `live-session/routes.ts` / errorBody/refusedResponse wrapping | `handle(SESSION_FAILURES, work)` | Needs the outer renderer noted above; retain optional headers and field detail. |
| `live-session/engine-call.ts` / executionOf scope, permissions, signal, subject | ``{ ...asking(call.scope, "read", call.signal, { kind: "session-task", id: `${sessionId}:${taskId}` }), policy: call.policy, idempotencyKey: call.idempotencyKey, traceId }`` | Keep the existing computed traceId and all stream metadata. |
| `coach/coach.ts` / stream execution | `{ ...asking(session ? { tenantId: session.tenantId, actorId: session.actorId } : ports.scope, "read", signal, { kind: "coach", id: epoch }), ...metadata }` | metadata means the existing policy, conversation, idempotencyKey and traceId fields, unchanged. |

## `products/interview/src/backend/` (convert last)

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `api.ts` / readBody + schema.safeParse + invalid_request guards | `const body = await input(context, schema, JSON_BODY_LIMIT_BYTES);` | Execution routes use EXECUTION_BODY_LIMIT_BYTES instead. Requires the outer v1 renderer: invalid_request/payload_too_large, message, issues and requestId are public fields. |
| `api.ts` / libraryMutationError and apiError catch blocks | `handle(LIBRARY_WRITE, work)` | All existing class/status/code/message mappings must survive in the renderer; the helper's code-only envelope is not the v1 envelope. |

Do not convert the three existing platform-contracts readBoundedJson users as part of this
Interview-local order: Presentation and apps/web must not import another product's transport.

## `products/interview/src/frontend/` and `studio/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `library.tsx` / requestJson | `return studioJson<T>(path, { method, body, signal });` | In its typed library client; inputs are decoded data, not JSON.stringify strings. Preserve existing error.message/issues display via StudioRequestError.payload. |
| `studio/studio.tsx` / currentOrigin | `const record = await studioJson<{ origin?: Origin }>(artifactPath);` | Preserve shell fallback on HTTP failure. |
| `studio/use-studio-lists.ts` / fetchJson | `return studioJson<T>(url);` | Tenant header comes from studioFetch. |
| `studio/playground-control.ts` / writeControlDraft read | `const { origin } = await studioJson<{ origin: unknown }>(path);` | Read before revision-aware write. |
| `studio/playground-control.ts` / writeControlDraft patch | `await studioJson(path, { method: "PATCH", body: { origin, patch: draft } });` | Same origin, patch and failure propagation. |
| `studio/studio.tsx` / useStoredFlag | `const preference = stored(key, ["open", "rail"], "rail");` | read() === open; write(next ? open : rail); keep controller state. |

`studio/use-playground-control.ts` currently requests `cache: "no-store"`; studioJson's specified
surface has no cache option. Keep that transport call until the endpoint's cache contract is
established. Do not silently drop no-store. `studio/account/sign-out.ts` uses its own credentials/
CSRF flow; it is not a Studio JSON conversion.

## `products/interview/src/frontend/studio/rehearsal/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `material.ts` / artifact loading | `const record = await studioJson<{ value: Draft }>(artifactPath(workspaceId, choice.ref));` | In the typed answers client if the page refactor has moved it there. |
| `config.ts` / clock | `export { formatClock as clock } from "../../format-time";` | Duration seconds, rounding, non-negative clamp. |

## `products/interview/src/frontend/studio/workspace/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `workspace-view.tsx` / local postJson | `return studioJson<T>(path, { method: "POST", body });` | Move to its typed workspace client; retain error.message from payload for display. |
| `use-canonical-draft.ts` / request | `return studioJson<T>(path + suffix, { method, body, signal });` | Decode the current pre-serialized init.body at the caller; map payload.code to WorkspaceRequestError; preserve revision conflict decisions. |
| `use-canonical-draft.ts` / versions | ``return studioJson<SavedAnswer[]>(`${path}/versions`);`` | Preserve versions-unavailable mapping. |

## `products/interview/src/frontend/studio/documents/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `documents-client.ts` / documentJson | ``return studioJson<T>(`${ROOT}${path}`, { method, body, signal });`` | Migrate callers to decoded bodies; remove checked only after all JSON callers move; preserve DocumentsApiError interface through a temporary boundary adapter if consumers still test it. |
| `documents-client.ts` / postJson | ``return studioJson<T>(`${ROOT}${path}`, { method: "POST", body, ...(signal ? { signal } : {}) });`` | Preserve cancellation. |
| `creation-mode.ts` / load/save | `export const creationMode = stored(KEY, ["ai", "manual"], "ai");` | load=read; save=write; exact KEY. |
| `document-writing.tsx` / clock | `import { formatClock as clock } from "../../format-time";` | Remove local duration function. |
| `new-document-dialog.tsx` / clock | `import { formatClock as clock } from "../../format-time";` | Remove local duration function. |
| `documents-model.ts` / relativeTime | `return Number.isNaN(Date.parse(iso)) ? "" : formatRelativeTime(iso, now);` | Full-word/floor text change explicitly noted above; preserve invalid-input empty label. |

Keep `documents-client.ts` postStream and download on studioFetch: NDJSON and blobs are not JSON.
`assistant-model.ts` reads arbitrary model IDs, not a fixed preference set.

## `products/interview/src/frontend/studio/live/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `hands-free-choice.ts` / load | `return stored(key(tenant), ["device-only", "permitted-remote", ""], "").read() || null;` | Empty sentinel preserves no choice/consent; never default to remote. |
| `hands-free-choice.ts` / save | `stored(key(tenant), ["device-only", "permitted-remote", ""], "").write(policy);` | Exact tenant key. |
| `session-format.ts` / clockLabel duration expression | `return formatClock(seconds);` | Keep invalid-date guards and existing floored seconds calculation. |

Keep `session-client.ts`'s typed transport: it retains an injected fetcher, `x-refusal-reason`,
schema parsing and SessionApiError's network/status semantics. studioJson cannot preserve the
refusal header or injected transport with its specified surface. `banner-copy.ts`'s ago uses
ageLabel in a live region (minute precision, no seconds announcements); it is not the relative
timestamp formatter. `ended-summary.ts`'s formatDayTime promises UTC; formatTimestamp is local.

## `products/interview/src/frontend/studio/live/overlay/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `auto-prefs.ts` / loadAutoPreferred | `return stored(key(tenant), ["on", "off"], handsFreeHost() ? "on" : "off").read() === "on";` | Host-specific fallback remains evaluated on read. |
| `auto-prefs.ts` / saveAutoPreferred | `stored(key(tenant), ["on", "off"], "off").write(on ? "on" : "off");` | Same values/key. |
| `auto-prefs.ts` / loadAutoHeartbeat | `return stored(heartbeatKey(tenant), ["on", "off"], "off").read() === "on";` | Default off. |
| `auto-prefs.ts` / saveAutoHeartbeat | `stored(heartbeatKey(tenant), ["on", "off"], "off").write(on ? "on" : "off");` | Same values/key. |
| `code-canvas.tsx` / runAllRequest | `return studioJson<RunResult>("/api/v1/run-all", { method: "POST", body: request });` | In runner client; map payload.error.message to the existing user-facing error. |
| `record-transcript.tsx` / ordinary GETs | `const recording = (await studioJson<{ recording?: Recording }>(endpoint(sessionId))).recording ?? null;` | Retain original error-to-null behavior and stale-response guards. |
| `record-transcript.tsx` / ordinary POSTs | `const recording = (await studioJson<{ recording?: Recording }>(endpoint(sessionId), { method: "POST", body: { on: next } })).recording ?? null;` | Use false for initial stop, next for the user action. |

Keep record-transcript's unload POST on studioFetch: `keepalive: true` cannot be represented by
studioJson. Keep auto interval (numeric/clamped), capture-prefs (JSON rectangle/settings), and
auto-owner-pause (timestamp plus memory on failed write) unchanged; stored has no such surface.

## `products/interview/src/frontend/studio/live/overlay/panels/`

| Path / site | One-line replacement | Contract to retain |
| --- | --- | --- |
| `behaviour-flags-setting.tsx` / GET | `const flags = behaviourFlagsResponseSchema.parse(await studioJson(ENDPOINT)).flags;` | Existing stale/unmounted guard; see tenant prerequisite below. |
| `behaviour-flags-setting.tsx` / PUT | `const flags = behaviourFlagsResponseSchema.parse(await studioJson(ENDPOINT, { method: "PUT", body: { key, value } })).flags;` | Existing failure counters and screen state. |
| `coach-notes.tsx` / request GET/DELETE | ``return studioJson<unknown \| undefined>(search ? `${ENDPOINT}?${search}` : ENDPOINT, { method });`` | Preserve query/space/revision; replace response.status===204 with payload===undefined before schema parse. |
| `context-pane.tsx` / context GET | `const read = contextViewResponseSchema.parse(await studioJson(path, { signal: stop.signal }));` | Same session/projection/q/stage URL and abort/stale guards. |
| `chat-view-pref.ts` / read/write | `const preference = stored(KEY, CHAT_VIEWS.map((view) => view.id), DEFAULT);` | Keep current cache, subscriber notification and SSR snapshot. |
| `coach-notes.tsx` / savedDock and setDock storage | `const dockPreference = stored(DOCK_KEY, COACH_DOCKS, "bottom");` | savedDock=read; setDock invokes write after setDockState. |
| `coach-columns.tsx` / coach text-size storage | `const textPreference = stored(TEXT_KEY, TEXT_SIZES, TEXT_DEFAULT);` | read/write inside existing cache and listener flow. |
| `tests-drawer-pref.ts` / read/write | `const preference = stored(TESTS_DRAWER_STORAGE_KEY, ["open", "closed", ""], "");` | Sentinel read maps to null, not false, to retain other windows' in-memory choice; keep storage event listener. |
| `panel-glass.ts` / read/write | `const preference = stored(GLASS_STORAGE_KEY, ["clear", "tinted", ""], "");` | Sentinel read maps to null; keep storage listener and attributes. |
| `shell-bridge.ts` / storage fallback only | `return stored(CONSENT_FLAG, ["1", ""], "").read() === "1";` | Native bridge remains first authority; no new consent writer. |

Tenant prerequisite: behaviour-flags and coach-notes currently use windowTenant(), whereas
studioFetch derives its header only from `/t/<slug>/...`. Before replacing those calls, prove
the native panel URL contains the same tenant or retain the existing typed transport; do not
drop the explicitly supplied tenant header. `use-account.ts` providers are tenant-independent,
and its CSRF/session requests plus sessionStorage welcome marker stay in the existing auth client.
Do not route auth work through a new preference helper.

## Audited non-conversions (not missing conversions)

- `studio/resizer.tsx`: numeric width, not a finite string preference.
- `studio/playground-control.ts`: applied snapshots are JSON.
- `studio/briefings/behavioural/matrix-picker.tsx`: arbitrary profile IDs; a dynamically allowed
  set is available only after loading, and no profile should disappear on a pre-load read.
- `studio/live/session-registry.ts`, `rehearsal-run-link.ts`, panels' coach-note-view.tsx and
  use-account.ts: sessionStorage scope/timestamp/CSRF semantics differ from localStorage.
- `studio/live/shared/use-missing-context.ts`: JSON array of missing keys.
- `studio/live/overlay/panels/start-panel.tsx`: arbitrary selected session ID.
- `studio/live/overlay/panels/coach-columns.tsx`: all widths/heights and split sizes are numeric
  or JSON; only TEXT_KEY is convertible.
- `studio/account/welcome-banner.tsx`: auth provider persistence is outside this preference order.
- `studio/live/shared/wasm-recognizer.ts`: OCR asset bytes, not JSON.
- `studio/live/shared/use-screenshots-view.ts` timeLabel, panels' answer-meta.ts clockTime and
  panel-model.ts clock: local wall-clock timestamps, not duration seconds. Keep them until a
  wall-clock helper's policy/signature is agreed; do not feed epoch milliseconds to formatClock.
- Brief's older home/use-plan.ts and briefings/behavioural/behavioural-pack.tsx requests are
  already behind typed package clients in this checkout; no studioJson conversion remains there.
- Presentation retains its helpers until a neutral package owns them; cross-product imports
  are forbidden. No model profile literals, timers, guards or script conversions in this order.

## Verification record

Only the product-interview typecheck and these six new test files run in this order, with
`VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2` and `--maxWorkers=2`. Tests are adjacent to each helper.
The streamed-bound test was also exercised negatively: disabling the actual readBytes limit
made three tests fail (`promise resolved ... instead of rejecting`), then the original file
was restored and re-read with its SHA256 matching the saved original. No existing tests edited.
Final scoped command (from products/interview):

```sh
VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2 pnpm exec vitest run --config vitest.config.ts src/backend/transport/body.test.ts src/backend/transport/route.test.ts src/backend/engine-asking.test.ts src/frontend/studio/studio-json.test.ts src/frontend/studio/shared/stored.test.ts src/frontend/format-time.test.ts --maxWorkers=2
```

Actual output: `Test Files 6 passed (6)`; `Tests 48 passed (48)`; exit 0.

`pnpm --filter @omnitech/product-interview typecheck` exited 2. No diagnostic named this order's
new files or public exports in the final run. The eight diagnostics were in other workers'
five Documents frontend files; they were not edited by this order:

```text
src/frontend/studio/documents/document-writing.tsx(6,10): error TS2305: Module '"./documents-ui"' has no exported member 'Spinner'.
src/frontend/studio/documents/documents-list.tsx(88,42): error TS2322: Property 'strong' does not exist on the library text component's props.
src/frontend/studio/documents/documents-ui.tsx(12,3): error TS2305: Module '"@oc-tech/omni-ui-components"' has no exported member 'TabsList'.
src/frontend/studio/documents/documents-ui.tsx(13,3): error TS2305: Module '"@oc-tech/omni-ui-components"' has no exported member 'TabsTrigger'.
src/frontend/studio/documents/documents-ui.tsx(117,27): error TS2322: Property 'level' does not exist on the library heading component's props.
src/frontend/studio/documents/documents-view.tsx(121,33): error TS2322: Property 'level' does not exist on the library heading component's props.
src/frontend/studio/documents/template-library.tsx(26,3): error TS2305: Module '"./documents-ui"' has no exported member 'IconButton'.
src/frontend/studio/documents/template-library.tsx(30,3): error TS2305: Module '"./documents-ui"' has no exported member 'Segmented'.
```

The three TS2322 rows above summarize the lengthy rendered prop types; the TS2305 rows are
verbatim. Full gate and browser acceptance were not run, as instructed.

## Exact parser sites from the current checkout

These AST-located sites expand the directory-level rows above. Line numbers identify this
snapshot; the schema expression and parameter name identify the site after owners move it.
All existing guards/error bodies still need their directory adapter described above.

| Path:line | One-line replacement |
| --- | --- |
| products/interview/src/backend/api.ts:568 | ``await input(context, libraryItemInputSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:588 | ``await input(context, libraryItemInputSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:664 | ``await input(context, routeRequestSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:682 | ``await input(context, generateRequestSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:707 | ``await input(context, explanationRequestSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:748 | ``await input(context, saveExplanationRequestSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:815 | ``await input(context, coachNoteInputSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:964 | ``await input(context, behaviourFlagInputSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:996 | ``await input(context, coachTranscriptInputSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:1012 | ``await input(context, coachActivityInputSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:1091 | ``await input(context, saveAnswerRequestSchema, JSON_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:1114 | ``await input(context, runRequestSchema, EXECUTION_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:1140 | ``await input(context, syntaxCheckRequestSchema, EXECUTION_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/api.ts:1166 | ``await input(context, runAllRequestSchema, EXECUTION_BODY_LIMIT_BYTES)`` |
| products/interview/src/backend/documents/api.ts:745 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:746 | ``await input(c, z .object({ jobDescription: z.string().max(20_000) }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:773 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:780 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:781 | ``await input(c, z .strictObject({ title: z.string().trim().min(1).max(200).optional(), jobDescription: z.string().max(20_000).optional(), notes: z.string().max(20_000).optional(), }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:803 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:854 | ``await input(c, z .strictObject({ companyName: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), jobDescription: z.string().max(20_000).optional(), interview: interviewInput.optional(), }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:867 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:868 | ``await input(c, interviewInput, MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:888 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:927 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:962 | ``await input(c, z .strictObject({ revision: positive, values: documentValuesSchema }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:967 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:983 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:990 | ``await input(c, z .strictObject({ expectedRevision: positive, instructions: z.string().max(16_000), }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1011 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1017 | ``await input(c, z .strictObject({ name: z.string().trim().min(1).max(200) }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1037 | ``await input(c, documentCreateSchema, MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1383 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1384 | ``await input(c, documentEditSchema, MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1431 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1432 | ``await input(c, z .union([ documentRegenerateSchema.extend({ aiTargetId: z.string().min(1).max(256), }), z.strictObject({ baseRevision: z.number().int().positive(), mode: z.enum(["all", "fix"]), aiTargetId: z.string().min(1).max(256), }), ]), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1657 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1658 | ``await input(c, z .strictObject({ baseRevision: z.number().int().positive(), block: z.string().min(1).max(40), roleId: z.string().regex(/^\/roles\/\d+$/), aiTargetId: z.string().min(1).max(256), }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1794 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1795 | ``await input(c, z .strictObject({ baseRevision: z.number().int().positive() }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1856 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1857 | ``await input(c, z .strictObject({ baseRevision: z.number().int().positive() }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1888 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1890 | ``await input(c, z .strictObject({ baseRevision: z.number().int().positive(), sourceRevision: z.number().int().positive(), }), MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1931 | ``await input(c, documentEditSchema, MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:1967 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:1968 | ``await input(c, documentExportSchema, MAX_JSON)`` |
| products/interview/src/backend/documents/api.ts:2040 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:2046 | ``param(c, "id")`` |
| products/interview/src/backend/documents/api.ts:2048 | ``param(c, "exportId")`` |
| products/interview/src/backend/brief/routes.ts:178 | ``param(c, name)`` |
| products/interview/src/backend/brief/routes.ts:193 | ``await input(c, stageCreateSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:201 | ``await input(c, stageOrderSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:209 | ``await input(c, stageUpdateSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:251 | ``await input(c, transcriptPasteSchema, TRANSCRIPT_JSON)`` |
| products/interview/src/backend/brief/routes.ts:355 | ``await input(c, transcriptAttachSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:397 | ``await input(c, transcriptUpdateSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:432 | ``await input(c, employerSaidInputSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:440 | ``await input(c, employerSaidUpdateSchema, SMALL_JSON)`` |
| products/interview/src/backend/brief/routes.ts:461 | ``await input(c, researchCreateSchema, RESEARCH_JSON)`` |
| products/interview/src/backend/brief/routes.ts:532 | ``await input(c, researchUpdateSchema, RESEARCH_JSON)`` |
| products/interview/src/backend/context-pack/routes.ts:203 | ``param(c, "id")`` |
| products/interview/src/backend/context-pack/routes.ts:216 | ``param(c, "id")`` |
| products/interview/src/backend/context-pack/routes.ts:217 | ``await input(c, packPrepareSchema, SMALL_JSON)`` |
| products/interview/src/backend/context-pack/routes.ts:303 | ``param(c, "id")`` |
| products/interview/src/backend/context-pack/routes.ts:304 | ``await input(c, packCorrectionsSchema, SMALL_JSON)`` |
