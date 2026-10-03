---
name: answer
description: Answer a coding-interview question and place the complete result in the open Playground
---

# Answer workflow

Treat the supplied arguments as the interview question.

1. Activate the `interview-question-router` skill and determine the language.
2. Extract the essential requirements, constraints, required names/signatures,
   observable behavior, and failure boundaries before writing code. Produce the
   simplest correct, interview-ready answer that satisfies that checklist and
   the user's relevant coding practices. Keep it specific; avoid generic
   boilerplate or speculative architecture. Preserve the exact signature and do
   not invent validation, but make every allowed boundary path deterministic and
   safe for a browser interview IDE. Exercise those paths in focused executable
   tests. Do not invoke another model unless the user explicitly requests
   configured AI generation.
3. Put the question, routed language, answer, main solution, executable
   usage/output, tests, notes, and appropriate panel into one JSON patch.
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
