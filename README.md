# Omnitech Studio

A tenant-aware product platform. Its first product, **Interview Studio**, helps
you prepare for and perform in technical interviews: runnable, explainable
answers, spoken briefings, mock interviews, and a hands-free live-session
assistant. Next.js is the delivery shell; each product's frontend and backend
live in `products/*`. See [Platform architecture](bionic/research/concepts/platform-architecture.md)
and [Adding a product](bionic/research/references/adding-a-product.md).

Interview Studio is served at `/t/<tenant>/p/interview`:

- **Home:** the upcoming interview, a prep plan, recent runs.
- **Workspace:** a question worked through Understand, Plan, Code, Test,
  Explain; solution, usage and test code run in isolated Docker containers
  (Pest, Vitest or RSpec); autosaved drafts and saved versions.
- **Briefings:** 60-90 second spoken briefs, and behavioural preparation packs
  built from your experience matrix.
- **Knowledge:** reviewed reference articles with search and facets.
- **Rehearsal:** timed mock interviews with a scorecard.
- **Assistant:** a docked assistant that proposes changes and applies them only
  when you accept.
- **Active Session:** a live session (web page plus an optional native macOS
  panel) that listens, understands the question and drafts an answer.

## Run it from scratch

You need: **Node.js 22+**, **Docker** (running), and **a language model** (step 3).
The macOS app (step 7) also needs Xcode's Swift toolchain.

1. **Install.**

   ```bash
   corepack enable
   pnpm install
   ```

2. **Build the code-runner images** (once; rerun after changing their Dockerfiles).

   ```bash
   pnpm runner:build
   ```

3. **Create your environment file and choose a model.**

   ```bash
   cp .env.example .env
   ```

   Open `.env`, find section 1, and uncomment **one** option (every option is
   a ready-to-edit example):

   | You have | Set |
   | --- | --- |
   | LM Studio running locally | nothing, or `LM_STUDIO_MODEL=<model id>` |
   | An OpenAI key | `OPENAI_API_KEY=sk-...` |
   | Another OpenAI-compatible endpoint (Ollama, vLLM, ...) | `AI_BASE_URL=...` and `AI_MODEL=...` |
   | No model, just a demo | `AI_BASE_URL=http://127.0.0.1:3000/api/fake/v1` and `AI_MODEL=fake-interview-model` |

   With no model set, `pnpm dev` uses LM Studio's loaded model (or asks it for
   `qwen/qwen3-coder-30b`) and says so on start; that works only if LM Studio's
   local server is running. Do not set `AI_MODEL` to "fill it in": any of
   `AI_MODEL`, `OPENAI_MODEL`, `OPENAI_API_KEY` or `LM_STUDIO_MODEL` turns that
   fallback off. Everything else in `.env.example` has a working local default.

4. **Start everything.**

   ```bash
   pnpm dev
   ```

   This starts PostgreSQL (Docker Compose, loopback port 54320), applies the
   database roles step, migrates and seeds it, builds the workspace, then runs the web app (port 3000), the terminal gateway
   (3001) and the agent worker. The first start builds the whole workspace
   first, so it is the slow one.

   **Database roles.** The app connects as `omnitech`, which has read/write
   grants only; migrations connect as `omnitech_owner`, which owns the schemas
   (`DATABASE_URL` and `DATABASE_OWNER_URL` in `.env.example`). The Postgres
   image runs `docker/postgres/init.sh` only when its data volume is EMPTY, so an
   existing volume never sees a changed init script. `pnpm dev` therefore runs
   `docker/postgres/ensure-roles.sql` on every start, before and after
   migrating: it is idempotent, changes ownership and privileges only, never
   touches data, and upgrades a database created before the split in place.
   Nothing needs the volume deleted. Postgres is published on `127.0.0.1` only.

5. **Open the app.** Go to <http://127.0.0.1:3000/t/local/p/interview> and use
   the **Local development** sign-in (passwordless; local only).

6. **Stop it.**

   ```bash
   pnpm dev:stop
   ```

   It shuts down what `pnpm dev` started and frees ports 3000 and 3001 if this
   repository holds them; other programs on those ports are reported and left
   alone. It is safe to run when nothing is up.

7. **Optional: the native macOS app** (a glass panel for Active Session).

   ```bash
   cd apps/studio-shell
   swift build -c release && scripts/bundle-app.sh
   open .build/InterviewStudioShell.app
   ```

   It is a development bundle, ad-hoc signed, so macOS asks for Screen Recording
   access again after each rebuild.

   The app loads Studio at `http://127.0.0.1:3000` (what `pnpm dev` and the Docker
   stack serve) unless you set another address in its connect prompt (status menu,
   "Change Connection..."; an empty field means the default). It remembers the
   address it was last connected to, so an app that was connected to another port
   needs "Change Connection..." once. Against `pnpm dev` it needs no sign-in.
   Against a **production build** (`next start`, or the Docker stack) it signs in
   itself on first launch, or after its web storage is cleared (a reinstall): the
   default browser opens, and with `FAKE_AUTH_ENABLED=true` it signs in as the
   local user with no password. Give a server you keep running its own
   `NEXT_DIST_DIR` (for example `.next-e2e-studio`); `pnpm verify` rebuilds the
   default `.next`, and a server still running from it then serves stale routes.

Problems on first run: "no model" means step 3; a database error means Docker is
not running; a Docker image error means step 2.

## Run it in Docker

The whole app can run in containers instead of on the host: Postgres, a one-shot
database setup, the web app on <http://127.0.0.1:3000> and the terminal gateway
(3001). It is one image (`docker/app/Dockerfile`) and compose services under the
`app` profile; everything is published on `127.0.0.1` only. The agent worker runs
on your Mac, not in a container (below).

```bash
pnpm dev:stop                                   # stop a host `pnpm dev` first (same ports, same database)
pnpm app:up                                     # build, set up the database, start everything incl. the Claude Code worker
docker compose --profile app logs -f web        # follow it
pnpm app:down                                   # stop (the data volumes stay)
```

Open <http://127.0.0.1:3000/t/local/p/interview>. This is a production build, so
you sign in once with **Continue as local user** (the macOS app signs in by itself
the first time). Settings come from your root `.env` (optional); an image rebuild
is needed after code changes. The first build installs and builds the whole
workspace and is slow.

What differs from `pnpm dev`:

- **LM Studio** runs on the host. The assistant's LM Studio transport (a vendored
  package) only talks to loopback and even rejects an API key, so the web and
  worker containers run a 20-line forwarder (`docker/app/forward.mjs`) that
  listens on their own `127.0.0.1:1234` and relays to `host.docker.internal:1234`
  (`DOCKER_LM_STUDIO_HOST` changes the target). The model is therefore loopback
  and really is this device, and the declared locality defaults to `device`; if
  you point it at another machine, set `LM_STUDIO_LOCALITY=remote`.
- **Running a coding answer's tests** needs the Docker runner, which would need
  the host's Docker socket. It is not mounted, so `ACTIVE_SESSION_CODE_RUNNER`
  stays unset in the containers and tests never run there.
- **The agent worker runs on the host.** Claude Code and Codex are signed-in
  command-line tools (their credentials live in your login Keychain) and only the
  worker may launch them, so they cannot run in a container.
  `scripts/docker-host-worker.sh start|stop|status` runs the worker against the
  same database and secrets. It needs `ACTIVE_SESSION_AGENT_PORT=on` and
  `ACTIVE_SESSION_AGENT_PROFILE=claude` (the script sets both; they are also in
  `.env`), and it needs no LM Studio or API endpoint: the Claude Code runner is a
  complete session gateway on its own, and a device-only session is refused
  because no on-device model is configured. A `container-worker` compose profile
  still exists for a worker with no agent runtime.
- **Secrets** default to throwaway local values; set `AUTH_SECRET` and
  `AGENT_PAYLOAD_SECRET` in `.env` for anything shared.

## Configuration

`.env.example` is the reference: every variable the code reads, grouped into
numbered sections, with its purpose, default and an example. Copy it to `.env`
and uncomment what you need.

- `pnpm dev` loads the root `.env`, then `apps/web/.env.local` (which wins).
  A variable exported in your shell wins over both. Both files are ignored by Git.
- Direct commands (`pnpm --filter <package> <script>`, a worker started by hand,
  the CLI, Playwright) do **not** load `.env`: export the variable in your shell.
- `pnpm dev` sets `DATABASE_URL`, local sign-in and throwaway secrets itself.
  Anything shared or deployed must set its own `AUTH_SECRET` and
  `AGENT_PAYLOAD_SECRET` and must not enable `FAKE_AUTH_ENABLED`.
- `scripts/env-docs.test.ts` fails when the code reads a variable that is not
  documented, or when `.env.example` names one nothing reads.

To make the docked assistant default to your signed-in Claude Code CLI, set
`INTERVIEW_ASSISTANT_DEFAULT_MODEL=agent/claude-code` (section 2). That is
separate from the model in step 3, which generated answers and Active Session
always use.

## Active Session

A live session for a rehearsal or an interview that everyone has agreed to be
recorded. Studio shows what the agent worker publishes, so **the worker must be
running** (`pnpm dev` starts it) and **a language model must be configured**:
with none, the session loop is off and no question is answered. Studio never
submits, sends or operates an external interview interface for you.

- **Locality.** Each session picks a policy. *Device only* uses only models
  whose declared locality is `device` (a loopback model on the worker's host,
  `LM_STUDIO_LOCALITY=device` or `AI_LOCALITY=device` with a localhost URL); a
  stage with no such model is refused, never sent elsewhere. *Allow remote*
  lets remote models answer. "On this Mac" assumes the app, worker and browser
  share one machine.
- **Retention.** Deleting a session removes its captured observations and
  records. A Workspace draft created from it remains until you delete it; it
  may still hold the captured question and generated answer. Backups keep
  copies until they rotate.
- **Logistics answers** (notice, compensation, work arrangement) use only
  approved candidate preferences; review personal commitments before saying or
  copying them.
- **Running tests for coding answers** needs `ACTIVE_SESSION_CODE_RUNNER=docker`
  (section 4 of `.env.example`) and the images from step 2.
- **The older Swift capture companion** (`apps/capture-companion`) is not started
  by `pnpm dev`; running it is **unverified** (no `Info.plist`, speech
  authorization not exercised). Its core and the TypeScript logic are covered
  by tests only.

## Code execution

`pnpm runner:build` builds `omnitech/pest-runner`, `omnitech/rspec-runner` and
`omnitech/vitest-runner`, used with `php:8.3-cli-alpine`, `ruby:3.4-alpine` and
`node:22-alpine`. Each run uses a temporary workspace, a timeout and an output
limit, and removes its container and files when done.

## Command line

```bash
pnpm cli:install:global
interview-answers configure --url http://127.0.0.1:3000 --token <INTERVIEW_API_TOKEN>
interview-answers health
interview-answers ask --language auto --question "Return the first unique character"
interview-answers explain --topic "Explain React reconciliation" --save
interview-answers playground set --question "Build an accessible React counter." --language react
interview-answers playground show | reset
interview-answers mock-interview start | end | reset
```

`ask` and `explain` generate for a tenant you belong to (`--tenant`, default
`local`). Pushes into the open Studio apply once, within about 500 ms: a question
and answer open as a Workspace draft, explanations appear under Briefings, and
`mock-interview` drives Rehearsal. Connection precedence: flags, then
`INTERVIEW_API_URL` and `INTERVIEW_API_TOKEN`, then
`~/.config/omnitech-interview-answers/config.json`.

## Working with coding agents

Project skills live once in `.agents/skills/`; `.claude/skills` and
`.opencode/skills` link to it, so Claude Code, Codex and OpenCode load the same
copy. `AGENTS.md` is the single instruction file. Slash commands: `/answer`,
`/explain`, `/playground`, `/playground-show`, `/playground-reset`,
`/mock-interview`, `/mock-interview-show`, `/mock-interview-reset`, `/verify`.

Development follows Crux: decisions, research, the journal and invariants live
in `bionic/` (see `bionic/AGENTS.md` and `USER_GUIDE.md`). Regenerate or check
the architecture map with `pnpm docs:arch` and `pnpm docs:arch:check`; use these
scripts rather than a bare derive-arch (see section 14 of `.env.example` for why).

## Repository layout

- `apps/web`: the Next.js shell and API routes. `apps/agent-worker`: Codex,
  Claude Code and Active Session jobs. `apps/terminal-gateway`: a WebSocket
  observer for agent-job events. `apps/studio-shell`: the native macOS app.
- `products/interview`: Interview Studio (manifest, frontend, Hono backend,
  services, tests).
- `packages/*`: single-purpose libraries. The ones you meet first are
  `database` (connection, tenant scope, migrations), `ai-runtime` (model and
  agent-profile resolution), `interview-contracts` (Zod schemas),
  `code-runner` (Docker execution) and `interview-answers-cli`.
- `e2e/live-session`: the browser suite. `vendor/`: packed sibling packages
  (`npm pack` in the source package and replace the tarball to update).

## Verify and test

```bash
pnpm verify              # lint, format, typecheck, coverage, build, native checks
pnpm test:no-docker      # the suites that need no Docker
pnpm test:integration    # real-provider checks; set ACTIVE_SESSION_AGENT_INTEGRATION
pnpm test:browser:install && pnpm test:browser   # Playwright, never part of verify
```

About 80 test files start a disposable PostgreSQL container and need a running
Docker daemon; they fail at once with a message saying so. Coverage thresholds
are 90% statements, 80% branches, 90% functions and 90% lines.

`pnpm test:browser` drives the real built web app and agent worker against a
scripted model, as **4 parallel shards** by default (each with its own database
and stack; `E2E_SHARDS=1` runs one process). It needs Docker and the Playwright
browsers. Options, the claims inventory and the shard design are in
`e2e/live-session/README.md`.

## CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `master` and manual
dispatch, with read-only permissions, no secrets, and superseded runs cancelled:

- `verify` (Linux): `pnpm install --frozen-lockfile`, `pnpm runner:build`, `pnpm verify`.
  The native step of `verify` skips itself on Linux and says so.
- `native` (macOS): `node scripts/verify-native.mjs`, the Swift build and test harnesses.
- `e2e` (Linux): the workspace build, Playwright browsers, then `pnpm test:browser`
  (4 shards in the one job); the Playwright report is uploaded when it fails.

The workflow has only been validated as YAML; it takes effect once pushed to
GitHub, and actions are pinned to major versions, not commit SHAs.
