# Omnitech Interview Answers Generator

A local-first interview playground that can also be driven by Codex, Claude, or
another tool through a stable CLI. The CLI hides the HTTP API and authentication
details; reusable packages keep AI providers, persistence, execution, and
interview-specific behavior separate.

## Quick start

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open <http://127.0.0.1:3000>. Drafts remain in the browser until **Save** is
selected.

## CLI automation

Install the standalone CLI package once:

```bash
pnpm cli:install:global
```

`interview-answers` is then available from any directory:

```bash
interview-answers configure --url http://127.0.0.1:3000 --token change-me
interview-answers ask --language auto --question "Return the first unique character"
interview-answers ask --file question.md --save --format json
cat answer.json | interview-answers save --format json
interview-answers list
```

Update the open Playground directly:

```bash
interview-answers playground set \
  --question "Build an accessible React counter." \
  --language react \
  --notes "Prefer the functional state updater." \
  --panel notes

interview-answers playground show
interview-answers playground reset
```

The CLI reads connection details from flags, environment variables, or
`~/.config/omnitech-interview-answers/config.json` in that order. Consumers
never need to construct API paths or headers. `save` accepts the same JSON shape
returned by `ask`; include its `id` to update an existing saved answer.

Generated Rulesync commands expose the same workflow to supported agents:
`/answer` solves a supplied question and updates the live form,
`/playground` routes show/reset/question operations, and
`/playground-show` plus `/playground-reset` provide explicit control shortcuts.

## Reusable packages

- `@omnitech/ai-sdk`: pluggable, provider-neutral AI SDK with a single public
  entrypoint.
- `@omnitech/interview-contracts`: shared schemas, routing, and prompt workflows.
- `@omnitech/interview-storage`: persistence interface and JSON-file adapter.
- `@omnitech/code-runner`: isolated Docker execution contract and adapter.
- `@omnitech/interview-api-client`: typed API client used by the CLI.
- `@omnitech/interview-playground-control`: configurable `get`, `set`, and
  `reset` SDK for the live Playground form.

Run `pnpm verify` before committing.
