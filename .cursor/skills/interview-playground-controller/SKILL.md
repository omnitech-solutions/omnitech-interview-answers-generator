---
name: interview-playground-controller
description: Read, update, or reset the live Interview Answers Playground through the global interview-answers playground CLI without exposing its HTTP API.
---
# Interview Playground controller

Use the global CLI as the only application-control boundary:

```bash
interview-answers playground set \
  --question "Build an accessible React counter." \
  --language react \
  --notes "Prefer the functional state updater." \
  --panel notes

interview-answers playground show
interview-answers playground reset
```

## Complete answer updates

For multiline answers, create one temporary JSON patch containing:

- `question`
- `language`
- `notes`
- `panel`
- `answer` with the title, Markdown explanation, primary code, and focused test
  code expected by the Playground contract

Apply it with:

```bash
interview-answers playground set --file <temporary-json>
interview-answers playground show
```

Prefer `--file` over fragile shell escaping. Delete the temporary file after a
successful update. Use `--panel notes` when notes are the requested focus and
`--panel output` when presenting a completed solution.

## Safety and verification

- Do not call Playground API routes with `curl`, `fetch`, or browser automation.
- Do not print or store API tokens.
- `show` is the source of truth for confirming a completed update.
- `reset` changes only the live form and does not remove persisted answers.
- If the CLI is missing, report that installation is required rather than
  silently substituting another transport.
