---
name: interview-playground-controller
description: Read, update, or reset the live Interview Answers Playground through the global interview-answers playground CLI without exposing its HTTP API.
---

# Interview Playground controller

The Playground is what Interview Studio (`pnpm dev`,
`http://127.0.0.1:3000/t/local/p/interview`) shows next. Each push is applied once:

- `question`/`answer`/`notes` open a Workspace draft; pushing the same question
  again updates that draft.
- `view`: `playground` → Workspace, `concept-lab` → Briefings › Concept
  explanations, `interview-preparation` → Briefings, `mock-interview` →
  Rehearsal.
- `mock-interview start|end|reset` drives the Rehearsal session.
- `panel` and an answer-less `language` are accepted but not shown.

Use the global CLI as the only application-control boundary:

```bash
interview-answers playground set \
  --question "Build an accessible React counter." \
  --language react \
  --notes "Prefer the functional state updater." \
  --panel notes

interview-answers playground show
interview-answers playground reset
interview-answers playground append-explanation \
  --topic "Follow-up topic" \
  --title "Short follow-up title" \
  --markdown-file /tmp/follow-up.md
```

## Complete answer updates

For multiline answers, create one temporary JSON patch containing:

- `question`
- `language`
- `notes`
- `panel`
- `answer` with the title, Markdown explanation, primary code, and focused test
  code expected by the Playground contract:
  - `code` for the main solution;
  - `usageCode` for executable representative usage/output;
  - `testCode` for executable focused tests

Apply it with:

```bash
interview-answers playground set --file <temporary-json>
interview-answers playground show
```

Use `interview-answers playground append-explanation` for subsequent Concept
Lab prompts in the current session. Append preserves the first briefing and
renders the new entry collapsed. Use a normal `set` with `explanation` to start
a replacement session.

## Non-technical interview briefings

Use the public CLI for candidate profile and briefing operations. Import an
explicit matrix file; never infer a profile path. Review each result before the
next mutation:

```bash
interview-answers briefing profiles
interview-answers briefing import --file <matrix.json> --name <candidate-name>
interview-answers briefing artifacts
interview-answers briefing show --id <artifact-id>
interview-answers briefing propose --id <artifact-id> --file <proposal-request.json>
interview-answers briefing apply --id <artifact-id> --proposal <proposal-id> --revision <current-revision>
interview-answers briefing save --id <artifact-id> --revision <current-revision> --request-id <unique-request-id>
interview-answers briefing open
```

`edit --id <artifact-id> --file <put-request.json>` accepts a reviewed
`{expectedRevision,briefing}` object. `show --id <profile-id> --revision
<profile-revision>` reads an imported profile. `--tenant <tenant>` selects a
scope; the default is `local`. Propose does not apply or save. Apply changes the
draft after explicit review. Save persists a reviewed revision only when
requested. The Next server may require an authenticated session; report that
error instead of bypassing auth.

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
