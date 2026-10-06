# VERIFY report (AU-SEC-04, NX-ERR-03, AN-ERR-01, TE-ARC-02, item 13 / NX-ARC-01/02)

Setup: own build `NEXT_DIST_DIR=.next-e2e-verify` (Next 16.2.11, `next build` succeeded, FAKE_AUTH_ENABLED=true at build), `next start` run
directly (`node_modules/.bin/next start`, so real exit codes). Own disposable `postgres:17-alpine` container `verify-pg-mig` (migrated with
`pnpm --filter @omnitech/database db:migrate`, 25 migrations, as NOSUPERUSER NOBYPASSRLS `fixture_app`). Everything stopped and the scratch
build dirs removed afterwards. Scripts: scratchpad `verify/` (run1.sh, sigterm.mjs, idle.mjs, handoff.mjs). No secrets printed (throwaway values).

## 1. Item 13 / NX-ARC-01/02: `next start` when `register()` throws

Question: does a throwing `register()` stop the process or the requests?

| Case | DATABASE_URL role / state | Result |
|---|---|---|
| pending | non-bypass role, empty DB | Process stays alive (exit never; killed by my SIGTERM, code 143). Prints `✓ Ready in 112ms`, then `Failed to prepare server Error [MigrationMismatchError]: ... 25 pending migration(s) (...): run pnpm db:migrate`. EVERY request returns **HTTP 500 "Internal Server Error" (21 B)**: `/sign-in`, `/api/auth/session`, `/api/auth/csrf`, `/api/native-auth/providers`, `/t/local`, `/nonexistent`, `/favicon.ico`. Still alive after 23 s. |
| superuser | role bypasses RLS | Same: alive, `Ready`, then `Failed to prepare server Error: ... database access refused: the database role bypasses row-level security ...`; all requests 500; alive after 14 s. |
| unreachable | `127.0.0.1:1` | Tolerant as designed: `/sign-in` 200, `/t/local` 307; `{"productWorker":"Error"}` logged (worker fails, server serves). `/api/auth/session` 500 only because FAKE_AUTH/AUTH_TRUST_HOST were not set in that probe (UntrustedHost), unrelated. |
| ok | migrated, non-bypass | `/sign-in` 200, `/t/local` 307, serves. |

Observation: no request is ever served in the two fatal cases (fail-closed holds), but `next start` does NOT exit: it prints "Ready" and keeps
the port open returning 500 forever. Exit code was never produced by the app itself. Time to first 500: ~0.6 s.
Verdict: **PROBLEM FOUND (minor, operational)**. Fail-closed on data is CONFIRMED OK, but a process supervisor / container healthcheck that only
checks "process alive" or "port open" will treat it as healthy and never restart. Recommend: document it in the deploy runbook, make the
health check an HTTP probe that must return 200 (`/sign-in` or a dedicated route), and, if a crash is preferred, have `instrumentation-node.ts`
log the fatal class and call `process.exit(1)` after the rethrow (a decision for the lead; it changes the NX-ARC-01 "CONFORMS" row to "conforms, with a
health-check requirement").

## 2. NX-ERR-03: extra SIGTERM/SIGINT listener vs Next's shutdown

Steps: `sigterm.mjs`: `next start` (ok DB), open a raw socket POST to `/api/auth/callback/local` with Content-Length 27 and only 5 body bytes sent
(Auth.js awaits the body, so a handler is in flight), `SIGTERM` the next process 1.5 s later. Run against (a) my build, (b) a copy of the same
build with the `process.once("SIGTERM"/"SIGINT", () => stop.abort())` call removed from the built chunk (baseline). No Next docs on shutdown exist
under `bionic/research`, and the installed `next` package is read-denied for me, so the baseline is empirical.

| Scenario | with listener (a) | without listener (b) |
|---|---|---|
| idle, SIGTERM | exit code 143 after 0.01 s | exit code 143 after 0.01 s |
| in-flight, body finishes 1.5 s after SIGTERM | process stayed up, the request was answered (`HTTP/1.1 302 Found`), then exit 143, 7.53 s after SIGTERM | identical: 302, exit 143, 7.53 s |
| in-flight, body never finishes | still running 19 s after SIGTERM (needed SIGKILL) | identical |

Findings: Next installs its own handler (exit code 143, not death by signal), drains in-flight requests, and waits for them (about 6 s of that is
keep-alive socket wind-down) and never force-closes a stuck request. The extra listener changed nothing observable (same timing, same drain, same
exit code). The listener only aborts product workers.
Verdict: **CONFIRMED OK**. Note for deploy: a hung request blocks exit indefinitely, so the orchestrator needs a kill grace period (SIGKILL after
N seconds). UNVERIFIED: worker drain on abort (workers were idle here; no job was running).

## 3. AU-SEC-04: handoff cookie behind a TLS-terminating proxy

Steps: `handoff.mjs`: built app with `NODE_ENV=production AUTH_TRUST_HOST=true`, dummy Google client id/secret (so `start` has a provider), no
FAKE_AUTH; a Node reverse proxy on another port sets `Host: studio.example.test`, `X-Forwarded-Proto: https`, `X-Forwarded-Host`, `X-Forwarded-For`.
Session for `complete` was minted with `encode` (secret, salt = cookie name), since a real Google sign-in cannot be done. Sequence: `start` (registers attempt),
`complete` (issues code), `redeem`, then `/api/auth/session` with the cookie `redeem` set.

| Config | Cookie Auth.js reads | redeem Set-Cookie | `/api/auth/session` with it |
|---|---|---|---|
| AUTH_TRUST_HOST=true, proxy sends X-Forwarded-Proto=https | `__Secure-authjs.session-token` only (plain name returns `null`) | `__Secure-authjs.session-token=<jwt>; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=lax` | 200, signed in as the member |
| same + AUTH_URL=https://studio.example.test | same | same | 200, signed in |
| AUTH_URL https, proxy forwards the public Host but NO X-Forwarded-Proto | `__Secure-` name (from AUTH_URL) | `authjs.session-token=<jwt>; ... HttpOnly; SameSite=lax` (no Secure) | **200 `null`: not signed in** (name mismatch) |

Findings: `next start` builds `request.url` from the forwarded headers, so with the usual proxy headers `url.protocol` is https, the name, Secure flag and
JWT salt match what Auth.js reads, and the handoff works (the premise "request.url is http" is false when X-Forwarded-Proto is set). It breaks only
when the proxy does not forward the protocol while AUTH_URL says https: the cookie is named and flagged for http and is never read.
Verdict: **CONFIRMED OK for a correctly configured proxy; PROBLEM FOUND (low) for a proxy without X-Forwarded-Proto.** Recommend: in
`redeem/route.ts` derive `secure` the way Auth.js does (honour `AUTH_URL` protocol, else `x-forwarded-proto`, and in production with trusted host and a non-loopback origin
default to secure), or document that the proxy must send X-Forwarded-Proto. Add a test with the forwarded header.
Could not simulate: a real TLS terminator / browser (no real https; I checked the `Secure` flag and `__Secure-` name in headers, not browser acceptance),
a real Google login (session minted with the app's own secret instead), the exact hosting product's header behaviour, WKWebView cookie handling.

## 4. AN-ERR-01: approval policy of every profile

Profiles in `packages/ai-runtime/src/config.ts` (all spread `BOUNDED`, `approvalPolicy: "never"`, line 176): coding-fast (codex), coding-quality (codex),
document-quality (claude-code), presentation-editor (claude-code), assistant-claude-code (claude-code), assistant-codex (codex). Environment chooses
only model names. Places that read the policy: `agent-runtime-claude/src/index.ts:397` (`"never"` -> `dontAsk`, else `default`; no `canUseTool`
anywhere in that package), `:184` (cache key), `agent-runtime-codex/src/index.ts:316` (passes it to Codex; `:89` denies interactive requests so Codex cannot hang),
`agent-runtime-contracts/src/index.ts:53,131` (type allows `"on-request"`; validation only constrains write sandboxes). Every other literal
(`scripts/benchmark-document-groups.ts`, `agent-runtime-claude/scripts/benchmark-transport.ts`, `agent-runtime-codex/scripts/check-tool-isolation.ts`,
`apps/agent-worker/src/session-e2e-support.ts`, and the tests) is `"never"`.
Verdict: **CONFIRMED OK**: no profile uses a non-"never" policy, so headless `default` mode cannot occur. The headless behaviour of `default` mode was
not exercised (UNVERIFIED, and unneeded). Guard test added: `packages/ai-runtime/src/approval-policy.test.ts` (new file; one `it.each` over every
profile; fails if a profile is non-"never" while `agent-runtime-claude/src/index.ts` has no `canUseTool`). Ran `pnpm exec vitest run packages/ai-runtime/src/approval-policy.test.ts`:
1 file, 6 tests passed; biome clean. Not run: a negative proof that the test fails (trivially an equality assertion).

## 5. TE-ARC-02: `corePath` contents

- Upstream doc (`docs/local-installation.md` at tag v7.0.0, fetched from GitHub; the installed README is read-denied for me, and the 7.0.0 README itself has no corePath
  text): corePath is a directory; lists four files (`tesseract-core.wasm.js`, `-simd.wasm.js`, `-lstm.wasm.js`, `-simd-lstm.wasm.js`). It predates the relaxedsimd variants.
- Installed `tesseract.js-core@7.0.0` ships 3 families x (js, wasm, wasm.js): base, simd, relaxedsimd, each plain and `-lstm`.
- Installed worker (`public/ocr/worker.min.js`, my copy, readable) names six files. It selects `relaxedsimd-lstm` / `simd-lstm` / `lstm` when the engine mode is LSTM-only
  and `relaxedsimd` / `simd` / base otherwise. The app creates the worker with `createWorker("eng", 1, ...)` (mode 1 = LSTM only), so only the LSTM variants are requested.
- `copy-ocr-assets.mjs` copies exactly the three LSTM `.wasm.js` files: a superset of what the doc requires for LSTM-only use minus the non-LSTM ones (never requested), plus relaxedsimd-lstm (which the doc omits but the 7.0.0 worker prefers).
- Served by the built app (`next start`): `/ocr/worker.min.js` 200, the three LSTM cores 200 (about 3.9 MB each), `eng.traineddata.gz` 200 (2.95 MB); the non-LSTM cores 404 (not requested in mode 1).
Verdict: **CONFIRMED OK by inspection** (copy list matches what the 7.0.0 worker requests for mode 1). **COULD NOT TEST**: a real recognition run on a generated PNG: the
tesseract.js main bundle is read-denied to me and is inside an app chunk with no standalone page, no existing e2e spec exercises the real WASM path (they use the shim),
and driving a full live session was out of scope. Recommend a small Chromium test that loads `/ocr` assets and recognizes a generated PNG (lead decision) if the guarantee matters; note that if the
engine mode ever changes to 0/2/3, the three non-LSTM cores must be added to the copy list.

## Repo changes
- Added `packages/ai-runtime/src/approval-policy.test.ts` only. Ran `node apps/web/scripts/copy-ocr-assets.mjs` (regenerates gitignored `apps/web/public/ocr`).
