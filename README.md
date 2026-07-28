# Interview Studio

A local-first, AI-assisted coding interview workspace. Interview Studio routes
questions to PHP, React, TypeScript, or Ruby; generates structured answers;
provides editable solution, usage, and test code; and runs code in isolated
Docker containers. Its Concept Lab prepares concise Markdown briefings for
full-stack concepts, DSA, system design, behavioural questions, and
candidate-experience stories.

The workspace can be used interactively in the browser or controlled by Codex,
Claude, shell scripts, and other tools through the `interview-answers` CLI. The
CLI and shared packages keep callers independent of HTTP routes and
authentication details.

## Current capabilities

- Automatic or explicit PHP, React, TypeScript, and Ruby routing.
- OpenAI-compatible AI providers, including hosted APIs and local servers.
- Built-in deterministic fake provider for local UI and transport testing.
- Editable CodeMirror solution, usage, and test tabs.
- Syntax checks and focused native runtime diagnostics.
- Docker-isolated solution and test execution with Pest, Vitest, or RSpec.
- Rendered React preview compiled locally with esbuild.
- Example templates with complete questions, solutions, usage, and tests.
- Explicit draft saving, saved-answer pagination, reopening, and deletion.
- Local draft recovery, theme persistence, and output word-wrap preferences.
- Inspector drawer for notes, run output, saved answers, and an interactive
  project-root terminal.
- CLI and generated Rulesync commands for reading, updating, resetting, and
  solving questions in the open Playground.
- Burger navigation between the default Playground and Concept Lab without
  discarding either workspace's draft state.
- Interview-ready Concept Lab briefings with talking points, trade-offs,
  rendered Mermaid workflows, GitHub-flavoured Markdown tables, browser draft
  recovery, and explicit saving.
- Interactive Mermaid controls for drag/pinch navigation, zoom in/out, reset,
  fullscreen viewing, syntax disclosure, and syntax copying.
- Experience-grounded explanations using the configured candidate experience
  matrix; unsupported personal claims are never invented.
- Deep-linked `/library` reference workspace with a DevDocs-style fixed index,
  section search, keyboard navigation, compact facets, and an independent
  article reader and table of contents.
- Eighty-five reviewed React, PHP 8.4, Laravel 13, Symfony, web, backend, and
  DSA references with explicit provenance and draft-then-publish authoring.
- Revisioned, persisted Orama indexes that rebuild automatically from
  authoritative Markdown when missing, stale, corrupt, or schema-incompatible.
- Shared safe Markdown rendering with linked headings, GFM, Mermaid, Shiki
  dual-theme highlighting, diff/focus annotations, and copy controls.

## Prerequisites

- Node.js 22 or newer.
- pnpm 10.33.3 through Corepack or a compatible pnpm 10 installation.
- Docker with a running daemon for syntax checks and code execution.
- `tmux` for the browser terminal.
- The `omni-ui-components` repository checked out beside this repository:

  ```text
  omnitech-solutions/
  ├── omni-ui-components/
  └── omnitech-interview-answers-generator/
  ```

  The web app currently links
  `../omni-ui-components/packages/core` as
  `@oc-tech/omni-ui-components`.

## Quick start

From the repository root:

```bash
corepack enable
pnpm install
cp .env.example apps/web/.env.local
pnpm runner:build
pnpm dev
```

Open <http://127.0.0.1:3000>. The development command starts both the Next.js
web app and the terminal gateway. The gateway listens at
`ws://127.0.0.1:3001/terminal` by default.

Open <http://127.0.0.1:3000/library> for the interview reference Library.
Library source records are stored in `INTERVIEW_DATA_DIR/library.json`; the
derived search index is disposable and rebuilt automatically.

Drafts are cached in browser storage for recovery. Answers are not persisted to
the JSON repository until **Save** is selected.

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

The web server reads the following variables from `apps/web/.env.local`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `AI_BASE_URL` | Base URL for an OpenAI-compatible `/v1` API | Required |
| `AI_MODEL` | Model sent to the provider | Required |
| `AI_API_KEY` | Optional bearer token for the AI provider | Unset |
| `AI_PROVIDER_ID` | Internal provider identifier | `default` |
| `AI_PROVIDER_LABEL` | Display label for the provider | `Default` |
| `AI_TIMEOUT_MS` | AI request timeout in milliseconds | `120000` |
| `INTERVIEW_API_TOKEN` | Bearer token required for non-same-origin API calls | Unset |
| `INTERVIEW_DATA_DIR` | Directory used by the JSON answer repository | `.data` |
| `INTERVIEW_EXPERIENCE_MATRIX_PATH` | Candidate evidence used for experience-based explanations | `~/dev/omnitech-solutions/docx-generator-studio/server/data/profiles/my-experience-matrix.json` |
| `NEXT_PUBLIC_TERMINAL_GATEWAY_URL` | Browser WebSocket terminal URL | `ws://localhost:3001/terminal` |

The terminal gateway accepts:

| Variable | Purpose | Default |
| --- | --- | --- |
| `TERMINAL_GATEWAY_PORT` | Local terminal gateway port | `3001` |
| `TERMINAL_GATEWAY_TOKEN` | Optional WebSocket query-string token | Unset |
| `INTERVIEW_PROJECT_ROOT` | Working directory opened by tmux | Detected workspace root |

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
  --topic "Give me a STAR story about modernizing a legacy workflow" \
  --save
interview-answers explain \
  --topic "How would the cache change for pagination?" \
  --append
```

Update the open Playground directly:

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

The open page polls for external control changes and applies them within roughly
500 ms. A complete Playground patch can also be supplied as JSON through
`--file` or stdin. Concept Lab keeps the first session briefing expanded;
explanations added with `--append` or
`POST /api/v1/playground-control/explanations` appear as collapsed follow-ups.

CLI connection precedence is command flags, `INTERVIEW_API_URL` and
`INTERVIEW_API_TOKEN`, then
`~/.config/omnitech-interview-answers/config.json`. The `save` command accepts
the JSON shape returned by `ask`; include an existing `id` to update a saved
answer.

## Agent workflows

Generated Rulesync commands provide the same workflow to supported coding
agents:

- `/answer` solves a supplied question and updates the live Playground.
- `/explain` creates a concise briefing and updates Concept Lab.
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
- `apps/terminal-gateway`: local WebSocket-to-PTY gateway backed by tmux.

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
