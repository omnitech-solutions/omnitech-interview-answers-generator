# WEB-HARDEN report

Base 074b883 plus the other workers' uncommitted changes; nothing committed. Everything below was run in this session unless marked UNVERIFIED.

## Per tracker row

| Row | Change (file) | Test |
|---|---|---|
| NX-SEC-02 | `poweredByHeader: false` (`apps/web/next.config.ts`) | `apps/web/next.config.test.ts`; e2e asserts no `x-powered-by` |
| NX-SEC-01 (headers) | `headers()` in `next.config.ts`: nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), microphone=(self), display-capture=(self)`, `Cross-Origin-Opener-Policy: same-origin`, `Content-Security-Policy: frame-ancestors 'self'` | `next.config.test.ts` pins the exact set and the route exclusions; `e2e/live-session/tests/security-headers.spec.ts` proves the running server sends it |
| NX-ERR-01 | `apps/web/app/global-error.tsx`: fixed message, no error text or digest, no stylesheet import, "Try again" calls `reset`. No `not-found.tsx` (would risk the 404 the shell relies on) | `app/global-error.test.tsx` (2) |
| HO-ERR-01 | `apps/web/src/platform/api-safety.ts` `apiErrorHandler`, registered by `api.onError` in `src/platform/api.ts`: fixed JSON body, only the error class is logged, an `HTTPException` keeps its status but loses its message. `packages/platform-api/src/router.ts`: malformed JSON on `PUT /preferences` is a 400 | `api-safety.test.ts`, `router.test.ts` (new case), `route.test.ts` (new cases, DB-backed) |
| HO-SEC-01 | `originGuard` in `api-safety.ts`, registered by `api.use("/api/*")`. Applies to POST/PUT/PATCH/DELETE: 403 fixed body when `Sec-Fetch-Site: cross-site` or an `Origin` whose host is not the request's `Host`. It applies whatever the content type (unlike Hono `csrf()`, which only checks form types). No Origin and no Sec-Fetch-Site (CLI bearer, Mac app HTTP client) passes untouched, as do the existing hand-rolled checks | `api-safety.test.ts` (8): CLI-style request, same-origin, forged cross-site for all four methods, foreign Origin, `Origin: null`, same-site other port, reads never blocked; `route.test.ts` forged vs CLI; e2e forged cross-site PUT 403 and own PUT 200 |
| AU-SEC-01 | `src/platform/auth-settings.ts` `resolveAuthSecret`: the committed string is used only when `FAKE_AUTH_ENABLED=true` and not production. `auth.ts` uses it at import and never throws. `instrumentation-node.ts` refuses to start with no secret (instrumentation does not run in `next build`) | `auth-settings.test.ts`, `auth.test.ts` (wiring), `instrumentation-node.test.ts` (refusal and the fake-auth exception). `NEXT_DIST_DIR=.next-e2e-harden next build` succeeds with no `AUTH_SECRET` (run directly and by the e2e stack, 3 times) |
| AU-SEC-03 | `resolveTrustHost`: `AUTH_TRUST_HOST=true/false` wins; otherwise true only outside production or with `FAKE_AUTH_ENABLED`. Documented in `.env.example` (env-docs guard passes) | `auth-settings.test.ts`, `auth.test.ts` |
| NX-SEC-04 | `import "server-only"` through one file, `src/platform/server-only.ts`, imported by `auth.ts`, `context.ts`, `fake-auth.ts`, `auth-settings.ts`. Tainting: not done (decided NO) | build with Turbopack resolves it; the whole apps/web suite still imports them |

## Findings worth your attention

1. **A `headers()` rule replaces a route's own header.** My first baseline overwrote the screenshot download's `Content-Security-Policy: sandbox` (caught by a new assertion in `capture-tasks-web.spec.ts`, red then green). The native sign-in completion page (`app/api/native-auth/complete/route.ts`, another worker's file, untouched) sets its own CSP, `no-referrer` and `X-Frame-Options: DENY`, and would have lost them. So the baseline source excludes those two routes (negative lookahead) and a second rule gives them only `nosniff`. The exclusion is a regex in `next.config.ts`; if either route moves it must change (e2e covers both).
2. **COOP `same-origin` is kept.** The only popups the code opens are `noopener` (`overlay-intents.ts:61`, links with `rel`), and OAuth is top-level redirects. Proof: `session-lifecycle-web` "Pop out" (real Document Picture-in-Picture window with the same-origin overlay iframe, bound to `frame-ancestors 'self'`) passes with COOP and the CSP on. Also passing under this header set: Chromium 40 tests (capture-tasks-web, session-lifecycle-web, security-headers, smoke-web-signin, web-signin-page, web-account); WebKit `@native` smoke-native, window-modes-native, mic-prompt-native, native-host (10 of 11) and smoke-web-signin.
3. **Permissions-Policy** was derived from what the code uses: `getUserMedia({audio})` (dictation, hands-free), `getDisplayMedia` (capture source, delegated to the PiP iframe by `allow="clipboard-write; display-capture"`, same-origin so `(self)` covers it); no camera or geolocation use anywhere. The e2e Chromium run uses the fake mic and screen share and passes.

## Not done or failing (not mine)

- WebKit `native-host.spec.ts:304` "host consent" times out. It fails identically with `headers()` emptied (re-run done), so it is not from this work; it sits in the NATIVE panel (new "Account: This Mac" toolbar and start-screen changes).
- `biome check` reports format errors only in other workers' new files: `e2e/live-session/tests/native-signin.spec.ts`, `zz-native-shots.spec.ts`.

## Small edits to files I do not own (all targeted)

- `vitest.config.ts` (root): the `node` project aliases `server-only` to the existing empty stub, because `scripts/route-classification.test.ts` imports `api.ts` and so `context.ts`.
- `scripts/route-classification.test.ts`: one `ALL /api/*` middleware row for the origin guard.
- `scripts/dependency-declarations.test.ts`: allowance for `server-only` in `apps/web` with a reason (delete it once declared).
- `e2e/live-session/tests/capture-tasks-web.spec.ts`: two assertions on the screenshot response headers; new `security-headers.spec.ts`.
- `.env.example`: `AUTH_TRUST_HOST` and an `AUTH_SECRET` note.
- Rebuilt `packages/platform-api/dist` (`tsc -b`) so apps/web resolves the router fix.

## For the lead

- **`server-only` is not installed or declared** anywhere in the repo (`require.resolve` fails; only Next's compiled copy exists). I did not run `pnpm install`. Next resolves the specifier itself at build, vitest uses the alias. To finish: add `server-only` to `apps/web` dependencies, install, then delete the `biome-ignore` in `src/platform/server-only.ts` and the allowance in `dependency-declarations.test.ts`.
- **Deploy impact:** a hosted production server must now set `AUTH_SECRET` (it already needed it; the server now refuses to start without) and `AUTH_TRUST_HOST=true` when behind a proxy. `pnpm dev` and the e2e stack are unaffected (both set `AUTH_SECRET` and `FAKE_AUTH_ENABLED`).
- `next build` prints an NFT warning tracing `next.config.ts` through `packages/code-runner/dist`. UNVERIFIED whether it predates my change (the trace is the config's `execSync` build id plus the runner's file reads); I did not build at the base to compare.
- The origin guard covers only the Hono app under `app/api/[[...route]]`. The Next route files (`api/auth`, `api/native-auth/*`, `api/integrations/*`) are separate handlers and are untouched; Auth.js has its own CSRF token, integrations use signed state, native-auth is the other worker's.
- Not run: `pnpm verify`, root build, Swift tests, the other e2e specs.

## Loopback Host trust (previous worker's note)

Confirmed: `isLoopbackHost` reads the client-supplied `Host`, and Next route handlers and server components expose no peer address. What bounds it: every script binds `127.0.0.1` (`next start --hostname 127.0.0.1`, `next dev --hostname 127.0.0.1`, the e2e stack), so a remote client cannot connect to forge anything; only a local process or a reverse proxy can. The realistic remote vector is DNS rebinding (a web page makes the browser reach 127.0.0.1 under an attacker hostname), and that is already refused, because its `Host` is not loopback. Nothing further tightens it reasonably inside Next. Recommendation: no code change now; keep the bind, and for any hosted target (a) never set `FAKE_AUTH_ENABLED` there, enforcing it with the AU-SEC-02 production refusal, and (b) if a proxy is introduced, have it overwrite `Host` and `X-Forwarded-*`, which the existing rule already treats as "elsewhere" when non-loopback. A runtime check of `socket.remoteAddress` would need a custom server, which is not worth the complexity (rule 1).

## ADR text

None needed. Decision to record in the tracker: the CSP is intentionally limited to `frame-ancestors 'self'` (full CSP deferred as decided), and `headers()` rules override route headers, so a route with its own policy must be excluded in `next.config.ts`.
