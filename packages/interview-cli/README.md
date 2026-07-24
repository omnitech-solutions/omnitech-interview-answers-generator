# @omnitech/interview-answers-cli

Global automation client for the local Interview Answers Playground. It hides
HTTP routes, authentication headers, and API response handling from Codex,
Claude, shell scripts, and human callers.

## Install globally from the workspace

```bash
pnpm --filter @omnitech/interview-answers-cli build
cd packages/interview-cli
pnpm --ignore-workspace link --global
```

The `interview-answers` command is then available from any directory:

```bash
interview-answers configure \
  --url http://127.0.0.1:3000 \
  --token change-me

interview-answers health
interview-answers ask --question "Find the first unique character"
interview-answers ask --file question.md --save --format json
cat updated-answer.json | interview-answers save --format json
```

## Control the open Playground

The CLI can update the form at the configured URL without exposing HTTP calls:

```bash
interview-answers playground set \
  --question "Build an accessible React counter." \
  --language react \
  --notes "Prefer the functional state updater." \
  --panel notes

interview-answers playground show
interview-answers playground reset
```

For a complete question-and-answer update, pass a JSON object with `question`,
`language`, `answer`, `notes`, and `panel` through `--file` or stdin. The open
page applies the update within 500 ms.

Configuration precedence is command flags, environment variables, then
`~/.config/omnitech-interview-answers/config.json`.

The package has one SDK entrypoint:

```ts
import {
  createConfiguredClient,
  createConfiguredPlaygroundControlClient,
} from "@omnitech/interview-answers-cli";
```
