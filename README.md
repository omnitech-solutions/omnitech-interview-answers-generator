# Omnitech Studio

Omnitech Studio is a pluggable, tenant-aware product catalog. Next.js provides
the cohesive delivery shell while product frontend and backend logic lives in
`products/*`. See [Platform architecture](docs/platform-architecture.md) and
[Adding a product](docs/adding-a-product.md).

Its interview product is **Interview Studio**, served at
`/t/<tenant>/p/interview`:

- **Home:** the upcoming interview, a prep plan with live status, recent runs.
- **Workspace:** a question worked through Understand → Plan → Code → Test →
  Explain, with editable solution, usage and test code run in isolated Docker
  containers (Pest, Vitest or RSpec), autosaved drafts and saved versions.
- **Briefings:** 60–90 second spoken briefs on concepts and system design, and
  evidence-backed behavioural preparation packs from a candidate experience
  matrix.
- **Knowledge:** reviewed React, PHP 8.4, Laravel 13, Symfony, web, backend
  and DSA references with search, facets and an article reader.
- **Rehearsal:** timed mock interviews with hints that cost points, a
  checklist and a saved scorecard.
- **Assistant:** a docked assistant that reads the open question, proposes
  changes for review, and applies them only when you accept.

Questions are routed to PHP, React, TypeScript or Ruby, and answers use any
OpenAI-compatible provider, hosted or local. Codex, Claude, shell scripts and
other tools can push questions, answers, explanations and rehearsals into the
open studio with the `interview-answers` CLI, which keeps callers independent
of HTTP routes and authentication details.

## Prerequisites

- Node.js 22 or newer.
- pnpm 10.33.3 through Corepack or a compatible pnpm 10 installation.
- Docker with a running daemon for syntax checks and code execution.
- A separate agent worker for Codex and Claude Code jobs.

Shared packages from sibling repositories ship as packed tarballs in
`vendor/`: `@oc-tech/omni-ui-components` (from `omni-ui-components`) and the
`@omnitech-assistant/*` packages. To take a newer build, run `npm pack` in that
package and replace the tarball, keeping its file name or updating the
`file:` references and `pnpm.overrides` to match.

## Quick start

From the repository root:

```bash
corepack enable
pnpm install
cp .env.example apps/web/.env.local
pnpm runner:build
pnpm dev
```

Open <http://127.0.0.1:3000/t/local/p/interview> for Interview Studio: Home,
Workspace, Briefings, Knowledge and Rehearsal, with the docked assistant. The
development command starts the Next.js web app (which also runs the
assistant's turns), the terminal gateway and the agent worker. The gateway listens at
`ws://127.0.0.1:3001/terminal` by default.

Stop everything the development command started (web app, terminal gateway
and agent worker) with:

```bash
pnpm dev:stop
```

It asks each launcher to shut down cleanly, then stops anything from this
repository that still holds ports 3000 or 3001. Other programs on
those ports are reported and left running. It is safe to run when nothing is
up.

Knowledge, inside Interview Studio, searches the interview reference library.
Library source records are stored in `INTERVIEW_DATA_DIR/library.json`; the
derived search index is disposable and rebuilt automatically.

Workspace drafts are saved to PostgreSQL as you edit; **Save version** keeps
an immutable copy.

### Deterministic local generation

The committed `.env.example` targets an OpenAI-compatible hosted endpoint. To
exercise the application without an external model, set these values in
`apps/web/.env.local`:

```dotenv
AI_BASE_URL=http://127.0.0.1:3000/api/fake/v1
AI_MODEL=fake-interview-model
AI_API_KEY=
```

The fake provider is intended for deterministic application and integration
testing, not realistic interview answers.

## Configuration

The web server reads the following variables from `apps/web/.env.local`.

**One model configuration serves the whole application.** The interview API,
the platform AI gateway and Interview Studio's assistant all resolve their
model from the `AI_*`, `OPENAI_*` and `LM_STUDIO_*` variables below through
`@omnitech/ai-sdk`, so changing a value changes it everywhere. When none is
set, `pnpm dev` uses the model LM Studio already has loaded and says so on
start, loading it with a 65,536-token window (`ASSISTANT_CONTEXT_TOKENS`) so
the assistant's history and output limits fit.

| Variable | Purpose | Default |
| --- | --- | --- |
| `AI_BASE_URL` | Base URL for an OpenAI-compatible `/v1` API | Required |
| `AI_MODEL` | Model sent to the provider | Required |
| `AI_API_KEY` | Optional bearer token for the AI provider | Unset |
| `AI_PROVIDER_ID` | Identifier for the `AI_*` provider | Inferred as `openai` or `lm-studio` |
| `AI_PROVIDER_LABEL` | Display label for the `AI_*` provider | Inferred from its URL |
| `AI_TIMEOUT_MS` | AI request timeout in milliseconds | `120000` |
| `AI_DEFAULT_PROVIDER_ID` | Default named provider (`openai` or `lm-studio`) | First configured provider |
| `OPENAI_MODEL` | OpenAI model offered when choosing a provider | Unset |
| `OPENAI_API_KEY` | OpenAI credential | Unset |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| `LM_STUDIO_MODEL` | Loaded LM Studio model identifier | Unset |
| `LM_STUDIO_BASE_URL` | LM Studio OpenAI-compatible endpoint | `http://127.0.0.1:1234/v1` |
| `INTERVIEW_API_TOKEN` | Bearer token required for non-same-origin API calls | Unset |
| `INTERVIEW_DATA_DIR` | Directory used by the JSON answer repository | `.data` |
| `INTERVIEW_EXPERIENCE_MATRIX_PATH` | Candidate evidence used for experience-based explanations | `~/dev/omnitech-solutions/docx-generator-studio/server/data/profiles/my-experience-matrix.json` |
| `NEXT_PUBLIC_TERMINAL_GATEWAY_URL` | Browser WebSocket terminal URL | `ws://localhost:3001/terminal` |
| `PLATFORM_HTTP_URL` | Platform API origin observed by the agent event gateway | `http://127.0.0.1:3000` |
| `AGENT_SERVICE_TOKEN` | Internal token shared by the platform and event gateway | Required outside local development |
| `AGENT_PAYLOAD_SECRET` | At least 32 characters; encrypts short-lived agent inputs | Falls back to `CONNECTED_ACCOUNT_SECRET` |

The terminal gateway accepts:

| Variable | Purpose | Default |
| --- | --- | --- |
| `TERMINAL_GATEWAY_PORT` | Local terminal gateway port | `3001` |
| `TERMINAL_GATEWAY_TOKEN` | Optional WebSocket query-string and HTTP bearer token | Unset |
| `AGENT_WORKER_ID` | Stable identity used for job leases | Generated UUID |

If `TERMINAL_GATEWAY_TOKEN` is enabled, include the same token in
`NEXT_PUBLIC_TERMINAL_GATEWAY_URL`, for example
`ws://localhost:3001/terminal?token=change-me`.

## Code execution

Build the local test-runner images once, and rebuild them after changing their
Dockerfiles:

```bash
pnpm runner:build
```

The runner uses:

- `php:8.3-cli-alpine` for PHP execution and
  `omnitech/pest-runner:latest` for PHP tests.
- `ruby:3.4-alpine` for Ruby execution and
  `omnitech/rspec-runner:latest` for Ruby tests.
- `node:22-alpine` for TypeScript execution and
  `omnitech/vitest-runner:latest` for TypeScript and React tests.

Each run uses a temporary workspace, has an execution timeout and output limit,
and removes its container and temporary files when finished.

## CLI automation

Build and install the standalone CLI globally from the workspace:

```bash
pnpm cli:install:global
```

Configure its API connection:

```bash
interview-answers configure \
  --url http://127.0.0.1:3000 \
  --token change-me
```

Common operations:

```bash
interview-answers health
interview-answers ask \
  --language auto \
  --question "Return the first unique character"
interview-answers ask --file question.md --save --format json
interview-answers list
cat answer.json | interview-answers save --format json
interview-answers explain \
  --topic "Explain React reconciliation and its performance trade-offs"
interview-answers explain \
  --topic "Give me a STAR story about modernizing an older workflow" \
  --save
interview-answers explain \
  --topic "How would the cache change for pagination?" \
  --append
```

Push into the open Interview Studio (the Playground channel):

```bash
interview-answers playground set \
  --question "Build an accessible React counter." \
  --language react \
  --notes "Prefer the functional state updater." \
  --panel notes

interview-answers playground show
interview-answers playground append-explanation \
  --topic "Cache follow-up" \
  --title "Pagination and cache keys" \
  --markdown-file follow-up.md
interview-answers playground reset
```

Interview Studio polls for pushes and applies each one once, within roughly
500 ms: a question and answer open as a Workspace draft, explanations appear in
Briefings › Concept explanations (the first expanded, follow-ups collapsed),
and `interview-answers mock-interview start|end|reset` drives Rehearsal. A
complete patch can also be supplied as JSON through `--file` or stdin.

CLI connection precedence is command flags, `INTERVIEW_API_URL` and
`INTERVIEW_API_TOKEN`, then
`~/.config/omnitech-interview-answers/config.json`. The `save` command accepts
the JSON shape returned by `ask`; include an existing `id` to update a saved
answer.

## Agent workflows

Generated Rulesync commands provide the same workflow to supported coding
agents:

- `/answer` solves a supplied question and updates the live Playground.
- `/explain` creates a concise briefing and shows it in Briefings.
- `/playground` routes show, reset, and question-update requests.
- `/playground-show` displays the current Playground state.
- `/playground-reset` clears the Playground.
- `/verify` verifies an interview answer.

Run `pnpm rulesync:generate` after changing the canonical `.rulesync` commands,
skills, or rules. Run `pnpm rulesync:verify` to confirm the generated `.codex`
artifacts are current.

## Workspace structure

### Applications

- `apps/web`: Next.js Interview Studio UI and Hono API routes.
- `apps/terminal-gateway`: WebSocket observer for normalized agent-job events.
- `apps/agent-worker`: isolated Codex and Claude Code job executor.

### Reusable packages

- `@omnitech/ai-sdk`: provider-neutral AI client with an OpenAI-compatible
  adapter and one public entrypoint.
- `@omnitech/interview-contracts`: shared Zod schemas, language routing, and
  prompt workflows.
- `@omnitech/interview-storage`: JSON repositories for saved coding answers and
  Concept Lab explanations, plus draft and published Library records.
- `@omnitech/interview-library`: Markdown section extraction, reviewed seed
  content, and the provider-neutral Library search interface with its Orama
  implementation.
- `@omnitech/code-runner`: isolated Docker execution, test, and syntax-check
  adapter.
- `@omnitech/interview-api-client`: typed API client used by automation tools.
- `@omnitech/interview-answers-cli`: global CLI and configured client factories.
- `@omnitech/interview-playground-control`: typed `get`, `set`,
  `appendExplanation`, and `reset` client for the live Playground.
- `@omnitech/interview-rulesync-codex`: validates and generates Codex-facing
  Rulesync artifacts.

## Quality gates

Run the complete pre-push verification:

```bash
pnpm verify
```

It runs repository linting, formatting checks, all package typechecks, coverage,
and production builds. Coverage thresholds are enforced globally at:

- 90% statements.
- 80% branches.
- 90% functions.
- 90% lines.

Useful focused commands:

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm --filter @omnitech/interview-library benchmark
pnpm hooks:run:pre-commit
pnpm hooks:run:pre-push
```
