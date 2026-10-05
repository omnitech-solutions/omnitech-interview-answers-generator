# L2 audit: backend / domain services / HTTP

Read-only. DB access shape is in `bionic/inbox/redesign/drizzle-audit.md` (not redone; routes.ts:210/220 raw SQL and the `tenant_id::text` cast in `interview-backend.ts` `isMember` are already listed there).

## 1. Scope and method

Read in full: `apps/web/src/platform/{api,context,agent-api,products}.ts`, `apps/web/auth.ts`, all `apps/web/app/api/**` and `app/model/**` handlers, `native-handoff.ts`, `packages/platform-api/router.ts`, `platform-runtime/registry.ts`, `platform-integrations/oauth.ts`, `interview-backend.ts`, `live-session/routes.ts`, `studio/host.ts`, `briefing-access.ts`, `api.ts` (legacy), the route/middleware/error blocks of `documents/api.ts`, `briefing/api.ts`, `plan/api.ts`, `briefs/api.ts`, `rehearsal/api.ts`, `presentation/backend/api.ts`, `services.ts`, `local-seeds.ts`, `structured.ts`, `trace.ts`, `credential-lookup.ts`, `session-credential.ts`, `active-session-contracts/limits.ts`. Cross-cutting greps (origin checks, `process.env`, `console.*`, `.message`, limits, `randomUUID`/`Date.now`) over the whole slice.

Checks run (read-only):
- `vitest run packages/platform-runtime/src/registry.test.ts "apps/web/app/api/[[...route]]/route.test.ts"` (product-routes-resolve-membership-first): registry file passes (10 tests); `route.test.ts` FAILS to start with `DATABASE_URL is required` (17 tests skipped). The check doc says "Environment: None"; it needs Postgres. It is therefore incomplete as a mechanical guard here, and `last_result` cannot be refreshed without the DB.
- `vitest run scripts/package-boundaries.test.ts scripts/raw-sql-guard.test.ts`: 18 pass.
- `git grep` next-in-backend (INV-0008): clean. Provider-names check: only frontend display matches (`task-card-model.ts:187`, `assistant-model.ts:6`), none in backend.
- agent-process check (INV-0005): reports 4 hits: three test files and `next.config.ts` (`execSync("git rev-parse")` at build time). None launch an agent. The check lacks `:!*.test.ts` and a build-config exclusion, so as written it fails on a healthy tree.

Not inspected: bodies of `assistant/adapter.ts`, `workspace.ts`, `documents/repository.ts` internals, `live-session` processor/assist/claims logic (T08 editing), the vendored `@omnitech-assistant/server` routes, `ai.ts` provider wiring beyond env reads. No dynamic testing.

## 2. Findings

| ID | Sev | Evidence | Rule | Fix | Lines | Risk | ADR |
|---|---|---|---|---|---|---|---|
| L2-01 | HIGH | `api.ts:125-146` `authenticate`: token enforced only if `INTERVIEW_API_TOKEN` set; and any caller sending `Origin: <own origin>` or `Sec-Fetch-Site: same-origin` skips it (client-controlled headers). Compared with `!==` (not timing-safe). Guards `/api/v1/*` (run, run-all, syntax-check, react-preview, answers, library CRUD, playground-control). `/api/fake/v1/*` has no auth | INV-0004, ADR-0004 d4, AGENTS 4 | Move legacy surface behind `scopeOf` membership (or remove from the hosted app and keep for local CLI only); drop the header bypass | 80-150 | med | y (decide fate of legacy `/api/v1`) |
| L2-02 | HIGH | `api.ts:560-768`, `services.ts:30-42`: answers, explanations, library, playground store are file-JSON/in-memory and global, not tenant-scoped (`playgroundControlStore` on `globalThis`). One tenant's data is visible to another once the gate in L2-01 is passed | ADR-0005, AGENTS 5 | Same as L2-01; if kept, local-only mount | with L2-01 | med | y |
| L2-03 | HIGH | `api.ts:771-818` `react-preview`: user code is bundled by esbuild with `resolveDir: process.cwd()`; imports of absolute or relative `.json`/`.js` paths are inlined into the response (arbitrary server-file read, inferred from esbuild bundling semantics); error text returns esbuild's message | security | Remove from hosted routes, or run bundle with a virtual-file plugin and no filesystem resolve | 40 | low | n |
| L2-04 | HIGH | `services.ts:158-160`: hard-coded `/Users/desoleary/.../my-experience-matrix.json` default; `generateExplanation` (`services.ts:163-185`) reads it and injects the author's personal matrix into the prompt for any scoped member, with no production or local-member guard (contrast `local-seeds.ts:34-40`, `interview-backend.ts` `isLocalMember`) | AGENTS 8 spirit, ADR-0005 (cross-tenant PII to model), memory note "real templates stay out of git" | Gate on `isLocalMember` or remove; path from one config | 30 | low | n |
| L2-05 | HIGH | `presentation/backend/api.ts:103-125` `contextFor`: only checks a context exists. No installation-enabled check, no `presentation.read/write` check on any route except shares (`:427`). Registry page path does both (`registry.ts:121-135`), the API does not | INV-0004 (membership, installation, permission before domain work) | One `presentationScope(context, method)` like `briefingScope`; 401/404 before service | 60 | med | n |
| L2-06 | HIGH | `auth.ts:10` registers the passwordless `local` Credentials provider on `FAKE_AUTH_ENABLED` alone (no `NODE_ENV` check); `context.ts:72` and `products.ts:49` add the `!== production` guard; `sign-in/page.tsx:26` unguarded | inconsistency, AGENTS 6 | One `fakeAuthEnabled()` in a config module, used by all four | 25 | low | n |
| L2-07 | MED | `studio/host.ts:310-325`: `GET /api/interview/workspaces/:w/artifacts/:a` creates a draft when none exists. Scope for GET needs only `interview.read` (`briefing-access.ts:19`), so a read-only member writes, and a cross-site top-level GET can trigger it | rule: reads do not write | Make creation an explicit POST/PUT | 30 | med | n |
| L2-08 | MED | Origin/CSRF guard copy-pasted 6x: `live-session/routes.ts:329-343`, `plan/api.ts:63-77`, `rehearsal/api.ts:111-125`, `briefs/api.ts:77-91`, `documents/api.ts:349-363`, `briefing/api.ts:440-466`; variants differ (`allowedOrigins` honoured in 4, not in routes/documents; `origin_forbidden` vs `origin-forbidden`). Missing on: `studio/host.ts` drafts (PATCH/POST save/run-code), `platform-api` PUT `/preferences`, `agent-api` POST/DELETE, all presentation mutations, `integrations` | duplication, inconsistency | One `sameOriginWrites(options)` Hono middleware in `platform-api`, applied in the shell to every mutating `/api` route | -150 net | med | n |
| L2-09 | MED | Four tenant-addressing schemes: path `/api/interview/t/:slug/sessions` (`routes.ts:51`), `x-omnitech-tenant` header or `?tenant=` (`interview-backend.ts:82-95`, duplicated inline at `:253-258`), `?tenant=` (platform, agent, presentation, ai-targets). ADR-0004 d4 says `/t/:tenantSlug/p/:productId/*` | ADR-0004 | Decide one; at minimum one `tenantSlugOf(request)` helper | 60 | med | y |
| L2-10 | MED | Six error envelopes: `{error:{code,message,requestId}}` snake (`api.ts:48`), `{error:{code}}` kebab (plan, briefs, rehearsal, documents), `{error:{code}}` snake (live-session), `{code,message}` flat (`host.ts:107-123`), `{error:"text"}` (agent-api, presentation, ai-targets), `{error:{code,message}}` (platform-api). Statuses vary for the same fault (invalid JSON: 400 in some, unhandled 500 in `platform-api/router.ts:61`, `plan/api.ts:135`) | inconsistency | Adopt live-session's `{error:{code}}` snake vocabulary and its shared status table (`LIVE_SESSION_ERROR_STATUS`) as the pattern; one `errorBody()` in `platform-contracts` | 200 | med | y |
| L2-11 | MED | Rule 8: `api.ts:526,552` `console.error(... error.message)` on generation failure; `instrumentation-node.ts:13` logs `error.message` from workers; presentation returns raw `error.message` to clients on generation/export/theme-import (`api.ts:395,511,559,616,668`); `agent-api.ts:114,242` return service `error.message`. Interview `structured.ts:48-56` already swallows provider errors correctly. Unhandled rethrows (`plan/rehearsal/briefs/documents onError ... throw error`) hand the error to Next's logger | AGENTS 8, ADR-0007 | Log only `{requestId, code}`; map unknown errors to fixed codes; copy `structured.ts` pattern | 60 | low | n |
| L2-12 | MED | Body bounds: live-session streams with a cap (`routes.ts:99-121`), documents has a near-identical clone (`documents/api.ts:113-135`), briefing trusts `content-length` then buffers text (`briefing/api.ts:460,558`), plan/briefs/rehearsal/platform-api/agent-api (500k prompt)/presentation (20 MB base64 field) have none | duplication, DoS | One `boundedJson(request, limit)` in `platform-api`; apply everywhere | -60 net | low | n |
| L2-13 | MED | Ingest does multipart buffering and `formData()` parse (up to 2 MiB + 40 KiB) before any credential or tenant check (`routes.ts:222-285`); credential shape (`presentedCredentialHash` is cheap) is validated later. No pre-auth throttle (inferred) | security hardening | Reject on credential shape before reading the body | 15 | low | n |
| L2-14 | MED | `agent-api.ts:121-126` service-token compare `===` (not timing-safe); `Number(query.after)` unvalidated (`:142,164`); `AGENT_PAYLOAD_SECRET ?? CONNECTED_ACCOUNT_SECRET` fallback reuses the OAuth vault key for payload encryption (`agent-api.ts:48`, `ai.ts:50,580`) | ADR-0006 (no key reuse), security | `timingSafeEqual`; zod query; drop the fallback | 20 | low | n |
| L2-15 | MED | `env`/config scattered: 80+ `process.env` reads, 52 in `ai.ts` alone; also `api.ts:127` per request, `services.ts:29,159`, `oauth.ts:41`, `products.ts`, `agent-api.ts`. Only `documents/config.ts` is injectable and validated | inconsistency | One `apps/web/src/platform/config.ts` parsed once (zod) and passed down | 200 | med | n |
| L2-16 | MED | `origin` checks aside, `/api/v1/health` etc. not at issue: `integrations/*/callback/route.ts:61-87` provider fetch errors unhandled (500), no timeout in `oauth.ts:123,139`; state is replayable within 10 min (no nonce) | hardening | try/catch to fixed 502; `AbortSignal.timeout` | 25 | low | n |
| L2-17 | LOW | `presentation/api.ts:48-60` loopback denylist by hostname string for stored image URLs (`127.1`, `0.0.0.0`, link-local, DNS rebinding pass). Stored and rendered client-side, so SSRF only if a server fetch is added (inferred; no server fetch found) | security | Document as render-only or validate resolved host | 20 | low | n |
| L2-18 | LOW | `routes.ts:164-178` `isOwnerStop` re-parses the control body the handler parses again; `routes.ts:289,292` `as never` casts for start/policy | tidy | Parse once in middleware | 30 | low | n |
| L2-19 | LOW | `randomUUID()` called inline in 14 files, `new Date()` in 8; live-session uses DB `now()` (good) and an injectable `Clock` in the worker only | testability | Leave; no action unless a test needs it | 0 | - | n |
| L2-20 | LOW | `model/[...path]/route.ts:27-31`: prefix check runs after `statSync`; symlinks inside the dir are followed (no `realpath`) | hardening | realpath then prefix | 6 | low | n |
| L2-21 | LOW | `native-handoff.ts` store is in-process; documented caveat. `trustHost: true` in `auth.ts:62` | note | none now | 0 | - | n |

## 3. Duplication map

| Cluster | Locations | Single owner |
|---|---|---|
| Same-origin write guard | routes.ts:329, plan:63, rehearsal:111, briefs:77, documents:349, briefing:440 (+ vendor assistant) | new `sameOriginWrites` middleware in `packages/platform-api` |
| Member scope preconditions | `briefing-access.ts:5-27`, `documents/api.ts:79-100` `resolveDocumentsScope`, presentation `contextFor` | one `productScope(context, slug, productId, {read, write})` in `platform-contracts`/`platform-api` |
| Slug from header/query | `interview-backend.ts:82-95` and `:253-258` | `tenantSlugOf(request)` |
| Bounded body reader | `live-session/routes.ts:99-121`, `documents/api.ts:113-135`, `briefing/api.ts:560` | `platform-api` `boundedBytes/jsonBody` |
| Error envelope/status | 6 shapes (L2-10) | `platform-contracts` `errorBody` + status table |
| 1 MiB limit | `local-default-profile.ts:31`, `briefing/repository.ts:65,119`, `briefing/api.ts:462,560` | one `BRIEFING_MATRIX_MAX_BYTES` in briefing |
| 2 MiB screenshot | `ACTIVE_SESSION_LIMITS.maxScreenshotBytes` (limits.ts:11) vs `maxOwnerCaptureBytes` (`interview-contracts/live-session.ts:334`); route uses one, `owner-capture.ts:67` the other | derive one from the other, add equality test |
| Experience matrix path | `services.ts:158`, `local-seeds.ts:22-40`, `local-default-profile.ts:7-8` | `local-seeds.ts` only |
| Fake-auth gate | `auth.ts:10`, `context.ts:72`, `products.ts:49`, `sign-in/page.tsx:26` | config module |
| Payload secret fallback | `agent-api.ts:48`, `ai.ts:50`, `ai.ts:580` | config module |

Other limits (single-sourced, good): 32 KiB envelope, 2 MiB screenshot, 120/min, 4 h cap, 2 h credential, 1 s heartbeat all live in `ACTIVE_SESSION_LIMITS` and are consumed from it (routes.ts:251, ingest.ts:474, owner-capture.ts:67). Route-local: 16 KiB JSON and 16 KiB capture fields (`routes.ts:59,65`), 128 KiB/5 MiB documents (`documents/api.ts:61-62`), 5 MiB/20 MiB/128 entries template intake (`template-intake.ts:12-14`). The "1000-char" figures are schema-local (`assist-stage.ts:184`) and not duplicated.

Interview vs presentation backend: both hand-roll scope resolution, error mapping and try/catch-per-route; presentation's blanket `catch { 401 }` (`api.ts:128-135`) turns a database error into 401.

## 4. Missing mechanical guards

| Rule | Proposed guard |
|---|---|
| Every mutating `/api` route has an origin guard and a membership/permission gate | `scripts/route-gates.test.ts`: enumerate routes by mounting `createApplicationApi()` with a stub context and issue each route as non-member and as read-only member, cross-origin; expect 401/403/404 before any repository call (fixes the gap in `route.test.ts`, which only samples) |
| Reads never write | same test: every GET with a spy repository asserts no write call |
| Rule 8 (no content in logs/errors) | `scripts/no-content-logging.test.ts`: ast-grep/TS scan of backend and `apps/web/src` for `console.*` and `error.message` in responses, with an allowlist like `raw-sql-guard.test.ts` |
| `process.env` only in config | same scan over `products/*/src/backend`, `packages/platform-*` |
| One limit, one constant | test asserting `maxOwnerCaptureBytes === ACTIVE_SESSION_LIMITS.maxScreenshotBytes` in `interview-contracts` |
| Fake auth never in production | unit test on the config module: `NODE_ENV=production` + `FAKE_AUTH_ENABLED=true` yields no `local` provider |
| INV-0004 check environment | edit check doc to state Postgres is required; INV-0005 add test/config exclusions |

## 5. Work packages (ordered)

1. WP-A security fixes, no behaviour change for valid callers: L2-06, L2-04, L2-14, L2-13, L2-20, L2-11 log lines. Files: `auth.ts`, `context.ts`, `products.ts`, `services.ts`, `agent-api.ts`, `routes.ts` (ingest block only; coordinate with T08), `instrumentation-node.ts`, `api.ts` logging. Tests: existing `api.test.ts`, `agent-api.test.ts`, `session-ingest.test.ts`, plus new fake-auth and timing tests.
2. WP-B shared edge helpers in `packages/platform-api` (`sameOriginWrites`, `boundedJson`, `errorBody`, `tenantSlugOf`, `productScope`); then migrate plan, rehearsal, briefs, documents, briefing, host drafts, presentation, platform-api, agent-api one router per commit. Needs ADR for the envelope and tenant-addressing choice (L2-09, L2-10). Depends on none; live-session `routes.ts` migrates after T08. Prove with `route-gates.test.ts` written first.
3. WP-C presentation gating (L2-05) using `productScope`; tests for disabled product and missing permission.
4. WP-D legacy `/api/v1` (L2-01, 02, 03): ADR on whether hosted app keeps it; interview-cli and `interview-api-client` are consumers (owner: L-client layer). Smallest fix: mount only when `FAKE_AUTH_ENABLED` local mode, delete header bypass.
5. WP-E config module (L2-15), then `process.env` scan test. Touches `apps/web/src/platform/ai.ts`; coordinate with the AI-layer worker.
6. WP-F draft GET-creates fix (L2-07) with frontend change in `studio` (L-frontend dependency).

## 6. Already good

- Live-session routes: membership resolved before any domain work, owner-only stop rule, fixed content-free error bodies and shared status table, `Cache-Control: no-store`, credential only in `Authorization`, query string refused on ingest, one identical credential refusal, SHA-256 credential hash with 256-bit random, DB clock (`now()`), `ACTIVE_SESSION_LIMITS` as single source, id-only trace sanitiser (`trace.ts`).
- `ProductRegistry.resolvePage` order (membership, installation, permission, then load) with tests; integration state HMAC uses `timingSafeEqual`; native handoff is single-use, hashed, TTL-bound, origin-bound.
- `studio/host.ts` and all interview sub-APIs go through one `scopeOf`; briefing zod messages name fields, never values; `documents/config.ts` is an injectable validated config.
- Backend has no Next imports; raw-SQL and package boundary tests pass.
