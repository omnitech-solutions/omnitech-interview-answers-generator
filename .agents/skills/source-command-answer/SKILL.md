---
name: "source-command-answer"
description: "Answer a coding-interview question and place the complete result in the open Playground"
---

# source-command-answer

Use this skill when the user asks to run the migrated source command `answer`.

## Command Template

# Answer workflow

Treat the supplied arguments as the interview question.

1. Activate the `interview-question-router` skill and determine the language.
2. Produce the simplest correct, interview-ready answer yourself. Do not invoke
   another model unless the user explicitly requests configured AI generation.
3. Put the question, routed language, answer, code, tests, notes, and appropriate
   panel into one JSON patch.
4. Apply it through `interview-answers playground set --file <temporary-json>`.
   The CLI is the control boundary; do not construct HTTP requests.
5. Confirm the visible state with `interview-answers playground show`.
6. Remove the temporary JSON file.
7. Do not save the answer to persistent storage unless the user asks.

For a small question-only update, this direct form is valid:

```bash
interview-answers playground set \
  --question "Build an accessible React counter." \
  --language react \
  --notes "Prefer the functional state updater." \
  --panel notes
```

If the Playground cannot be reached, report the exact CLI error and preserve the
prepared answer so it can be applied after the app starts.
