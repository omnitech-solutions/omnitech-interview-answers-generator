---
description: Inspect, update, or clear the open Interview Answers Playground
---
# Playground control

Use the `interview-playground-controller` skill. The command arguments determine
the operation:

- `show`: run `interview-answers playground show`.
- `reset`: run `interview-answers playground reset`, then confirm with `show`.
- A coding question: solve it using the `interview-question-router` skill, apply
  the complete result with `playground set`, then confirm with `show`.
- Explicit field values: pass them to `playground set` using supported flags.

Never replace this workflow with direct HTTP calls or browser automation. Use a
JSON file or stdin when an answer contains multiline Markdown, source code, or
tests.
