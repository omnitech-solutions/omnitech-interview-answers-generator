# Live session browser suite

Playwright specs for the Active Session, web page and native panel. The rule of
the suite: **a control or claim is marked covered only when a spec observes its
real effect**, never by presence alone: a row the server holds, an HTTP result,
a recorded native bridge call, clipboard contents, or a DOM change only the real
behaviour can produce. The claims inventory says which are covered and which are
still `pending` (a worklist, not a promise: see "The claims inventory").

Run it explicitly. It is not part of `pnpm verify`.

```bash
pnpm test:browser:install        # once: downloads Playwright Chromium and WebKit
pnpm build                       # the web app loads every package from dist
pnpm test:browser                # the whole suite, as 4 parallel shards
E2E_SHARDS=1 pnpm test:browser   # one process, one stack (1 to 8 shards; default one per two CPU cores, 1 to 4)
E2E_LIVE=1 pnpm test:browser     # timestamped START/END line per test
pnpm test:browser tests/smoke-web-end.spec.ts --project=chromium   # one spec
E2E_HEADED=1 pnpm test:browser   # watch the browser
E2E_STRICT=1 pnpm test:browser   # claims still `pending` fail the run
E2E_REBUILD=1 pnpm test:browser  # force a fresh `next build`
E2E_BROWSER_CHANNEL=chrome pnpm test:browser   # installed Google Chrome instead
E2E_DIST_DIR=.next-e2e-mine pnpm test:browser  # own build dir, safe beside another run
```

`E2E_DIST_DIR` must start with `.next-e2e` and contain no path separator (checked
in `src/stack/dist-dir.ts`, before Playwright clears anything); every guard,
formatter and ignore file treats any `.next-e2e*` directory as build output.
Results and the HTML report go to dot-directories (`.test-results`,
`.playwright-report`, or `<E2E_DIST_DIR>-results` / `-report` for a run with its
own build dir) so the architecture scan skips them; all are gitignored.
Two runs that share a build directory would overwrite each other's `next build`,
so parallel runs (or parallel agents) each set their own.

Requirements: Docker running (a disposable `postgres:17-alpine`), the browsers
above, a built workspace, and the code-runner image (`pnpm runner:build`; the
runner starts it with `--pull=never`). `pnpm test:browser` checks Docker and the
browsers, and the global setup checks the workspace and the image, each stopping
with one message naming the fix. The suite uses free loopback ports and its
own database: never :3000, :3100 or your dev databases.

## Architecture

One global setup (`src/stack/stack.ts`, one process) starts, in order:

| Piece | Real or scripted |
|---|---|
| PostgreSQL (`startDisposablePostgres`), migrations, `grantApplicationRole` | real, member role (RLS applies) |
| Platform bootstrap (`local` tenant and user), run as the member role | real |
| OCR assets (`node apps/web/scripts/copy-ocr-assets.mjs`, run before every `next build`) | real, copied into `apps/web/public/ocr` |
| `next build` (own dist `apps/web/.next-e2e`, reused while the source stamp is unchanged; the stamp covers git-visible source AND a content hash of every built `packages/*/dist` and `products/*/dist`, so rebuilding a package always rebuilds the web app) and `next start` on a free port | real production build |
| Fake sign-in (`FAKE_AUTH_ENABLED`), cookies written as a Playwright `storageState` | real Auth.js flow over HTTP |
| Agent worker, in this process via `runConfiguredAgentWorker(env, signal, runtimes)` | real worker, real session loop, real session agent port, real screenshot staging |
| The agent runtime handed to the worker (`claude-code` shape) | **scripted** (`src/stack/control.ts`) |
| Direct device model (`AI_BASE_URL`, declared on-device) | **scripted** (`/v1/chat/completions` of the control server) |
| Screen share | real `getDisplayMedia`, accepted by Chromium launch flags |
| Microphone | Chromium's fake device; **WebKit never reaches the real one**: every WebKit context gets `src/fixtures/webkit-mic-guard.ts`, which replaces `getUserMedia`, `enumerateDevices` and the speech recognisers in the page (macOS shows its 'Allow microphone' dialog even headless otherwise), and a test fails if a page loaded without it |
| Native `window.studioHost` bridge | **recording shim** (`src/fixtures/host-shim.ts`) |

The seam for the scripted model is the `runtimes` map of
`runConfiguredAgentWorker` (the same seam `apps/agent-worker/src/main.test.ts`
uses): with `ACTIVE_SESSION_AGENT_PORT=on` and `ACTIVE_SESSION_AGENT_PROFILE=claude`
the session agent port runs the assist and coding stages on `runtimes["claude-code"]`,
which is `fakeRuntime(state)`. The worker's database is the member URL, so the
role check passes as in production.

Specs run in other processes; the stack publishes its addresses as JSON in
`E2E_STACK_CONFIG` (`src/stack/config.ts`, typed).

## Scripted model and control API

Scenarios are chosen by **name** through the control server, never by reading the
screenshot (`src/stack/scenarios.ts`: `plain-answer`, `coding-answer`,
`missing-context`, `withheld-preference`, `withheld-figure`, `refusal`,
`provider-failure`, `timeout`). The `Control` client (`src/stack/control.ts`):

```ts
await control.scenario("coding-answer");                 // sticky default
await control.scenario("missing-context", { once: true });// next assist call only
await control.scenario("plain-answer", { delayMs: 3000 }); // slow run
await control.scenario("plain-answer", { hold: true });   // hold at the gate
await control.waiting();            // runs held at the gate
await control.release(1);           // release the oldest held run
await control.calls();              // recorded calls (metadata only)
await control.reset();              // automatic before each test
```

HTTP: `POST /scenario {name, delayMs?, hold?, once?}`, `POST /gate/release
{count?}`, `GET /gate`, `GET /calls`, `POST /reset`, `GET /problem` (the fixture
page that plays "the problem on screen"; `?variant=cutoff`), `GET /health`,
`POST /v1/chat/completions` (device-only model).

Calls are recorded as **metadata only**: stage (`assist` | `solve`), scenario,
task id, revision, image count, image bytes and 8-hex digests, prompt length,
path (`agent-runtime` | `direct-model`), outcome. Never a prompt, an answer or an
image (AGENTS.md rule 8 holds for the harness). Worker trace lines (also
content-free) go to `.stack/<pid>/worker.log`, and the web server's own stdout and
stderr to `.stack/<pid>/web.log` (one folder per run, gitignored; folders of runs
that are no longer alive are removed at the next run's global setup). The privacy
spec reads both for its canary.

Add a scenario: add its name to `SCENARIO_NAMES`, its output (valid against the
stage schemas in `assist-stage.ts` / `coding-stage.ts`) to `script()`, and any
text a spec looks for to `SCRIPTED`.

## Fixtures and helpers

- `src/fixtures/test.ts`: `test`/`expect` with the signed-in storageState,
  `control` (reset per test), an automatic `cleanSlate` (ends sessions an earlier
  test left open), `live` (web page object), `native` (a context with the host shim).
- `src/fixtures/host-shim.ts`: `installHostShim(context)` injects
  `window.studioHost` before page scripts, modelled on `studio-host.ts` and the
  script in `HostBridge.swift` (capabilities, presentation ops, screen-watch, engine,
  hotkeys, `recognizeText`). Accepted calls are recorded in the wire shape the
  Swift decoder accepts. Calls the decoder refuses (window size outside
  200..4000 x 60..4000, an unknown app mode, hit regions beyond 64 rectangles or
  with a non-finite or out-of-range side, a `captureScreen` with an unknown key,
  a region outside the unit square or a `displayId` without `mode: "region"`, an
  `openExternal` address that is not http(s) without user info or the one Screen
  Recording settings address) REJECT as in the shell, are listed by
  `host.rejected()`, and fail the test at its end. Not ported: the parameter
  checks of `screenWatchStart`. The shell offers `text-recognition` (Apple Vision)
  when Vision answers, so the shim advertises it by default with a `recognizeText`
  stub (no text found, blank-frame metrics; `host.setRecognizeText(...)` changes
  it); `shim: { textRecognition: false }` is a shell without Vision, so the page
  runs its in-page engine. The stub proves how the page USES the capability, not
  what Vision reads.
  `host.calls("setWindowSize")`, `host.fireIntent("chat.focus")`,
  `host.setInteraction(false)`, `host.fireScreenChange()`, `host.setCapture(...)`,
  `host.refuse("setVisible")`. `nativeOverlayUrl()` builds the URL exactly as the
  shell does (`?host=native&panel=single|settings&handsfree=1&session=<id>`).
- `src/helpers/sql.ts`: SQL on the disposable DB as its owner. Reads only (ids,
  statuses, counts; never content columns), except `db.moveClock(id, {...})`,
  the one write: it moves a session's duration cap and/or credential expiry so a
  spec can see the banners that need time to pass (the cap is an immutable
  creation field, so that one statement runs with triggers off, after checking
  the role is `fixture_owner`, on the disposable fixture database only).
  `stackConfig()` refuses an owner URL that is not `fixture_owner` on `127.0.0.1`. `src/helpers/api.ts`:
  `startSessionViaApi`, `controlSession`, `sessionApi` with the signed-in cookie,
  `renewCredential` (a fresh companion credential for a page-started session) and
  `ingest` + `envelopes` (what the capture companion sends: transcript, source
  disconnect, capture gap), authenticated by credential alone as in production.
- `src/pages/`: `LivePage` and `SetupPage` (web) and `NativePanel`, by accessible role and name.

Web-first assertions only: `expect(...).toBeVisible()`, `expect.poll(...)`. No
fixed sleeps.

## The claims inventory

`src/claims/claims.ts` lists every interactive control (web and native) with what
its label says it does and the effect that proves it. `tests/claims-coverage.spec.ts`:

1. scans the rendered pages in every state (`src/claims/scan-states.ts`: sign-in,
   setup, live, each task kind, paused, ended; the native panel, its menus,
   collapsed, paused, ended, Settings) and **fails on any control not in the
   inventory**;
2. fails on a `covered` claim whose `spec` title does not exist in `tests/`;
3. fails when a row's own `spec` and its `COVERED_BY` entry name different specs;
4. prints covered/pending counts; `pending` fails only under `E2E_STRICT=1`.

To cover a claim: write the spec that observes the effect, then set
`spec: "<a substring of its title>"` (the entry becomes `covered`). To add a state
the scan misses, extend `scan-states.ts`.

## Reading failures

Failed tests keep a trace and screenshot: `pnpm exec playwright show-trace
.test-results/<test>/trace.zip` (from this directory) shows each action, DOM
snapshot, network call and console line. `.playwright-report/` has the HTML report
(`pnpm exec playwright show-report`). `E2E_HEADED=1` watches a run.

## What Playwright cannot prove (manual/AX checklist, plan.md 7.7)

- Apple Vision's text (the shim's `recognizeText` is a stub), ScreenCaptureKit
  capture, the screen-recording permission, the real focused
  window (the shim returns a drawn JPEG; the web path uses a real
  `getDisplayMedia`).
- Carbon global hotkeys (the shim delivers the intent the shell would send).
- Real window geometry: the yellow dot's pivot about the centre, the green dot's
  restore, glass over the desktop, always-on-top, click-through really passing
  mouse events, drag from empty areas, `ignoresMouseEvents`.
- The bundled agent worker (`apps/agent-worker/dist/main.js`) and a real Claude or
  Codex process: the suite runs the worker from source with a scripted runtime.
- Real app audio and the companion's own capture.
- WKWebView specifics beyond what WebKit shows (the WebKit project is the closest
  browser match, not the same engine build).

## Known product behaviour the harness observed

- With no open session the native panel **and the Settings window** show
  "Consent required" (`panels-root.tsx`: both need a session). The scan opens
  Settings with a session id for that reason.
- An unauthenticated request to a tenant page answers 404, not a redirect to
  `/sign-in` (auth is inferred this phase, D18).

## Known browser limits

- **Bundled headless Chromium dies on the on-device speech path.** Starting a
  DEVICE-ONLY session from the setup page makes the page ask the Web Speech API
  for on-device recognition (`processLocally`, `dictation.ts`). The bundled
  `chrome-headless-shell` has no Mojo binder for `media.mojom.OnDeviceSpeechRecognition`, so
  the browser kills the renderer ("Page crashed", about 1 s after the start
  POST). Installed Chrome (`E2E_BROWSER_CHANNEL=chrome`) and a page with no
  `SpeechRecognition` (an init script that undefines it) both run it fine; it is
  not WebGPU or a model load (the device model is the server-side direct path).
  Headless-only: a real browser has the binder. Specs that need a device-only
  session start it over the API (`startSessionViaApi({processingPolicy})`), or
  install `browser-spies` before the page loads, instead of pressing Start.

## Live output

`E2E_LIVE=1 pnpm test:browser ...` adds a wall-clock `START`/`END` line per test
(project, `file:line`, title; `src/reporters/live-reporter.ts`), so a screen
recording can be matched to the test that was running.

## Shards

The whole suite runs as `E2E_SHARDS` parallel Playwright processes (default one
per two CPU cores, from 1 to 4, so a 2-core CI runner runs one; at most 8; `.env.example`). The web app is built once, then each shard starts
its own stack: its own PostgreSQL container, ports, worker, storage state and
`.stack/<pid>` folder, so shards share nothing but the read-only web build.
Output lines carry `[s1]`..`[sN]`; each shard writes `.test-results/sN` and
`.playwright-report/sN`. Naming spec files, or using `--shard`, `--list`, `--ui`
or `--debug`, runs one process. The first sharded run took 370 s against 19.1
min serial; shard sizes are uneven (files are the unit of splitting).
