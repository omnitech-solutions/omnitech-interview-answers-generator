---
name: codex-interview-routing
description: Route explicit interview commands and plain-language coding or concept questions to the matching answer, explanation, or Playground workflow in Codex. Use for /answer, /explain, /playground, /playground-show, /playground-reset, /verify, or requests that clearly ask to solve, explain, display, update, reset, or verify interview preparation.
---

# Codex interview routing

Classify the request before taking action. Preserve the user's requested
language and output format.

## Routes

- A coding question or `/answer` -> read `.codex/commands/answer.md`.
- A concept, trade-off, system, or experience question without a coding
  solution, or `/explain` -> read `.codex/commands/explain.md`.
- A request to solve a question and update the app, or `/playground` -> read
  `.codex/commands/playground.md`.
- A request to inspect the current app state, or `/playground-show` -> read
  `.codex/commands/playground-show.md`.
- A request to clear the current app state, or `/playground-reset` -> read
  `.codex/commands/playground-reset.md`.
- A request for validation evidence, or `/verify` -> read
  `.codex/commands/verify.md`.

For an explicit command, activate the generated
`codex-interview-route-<command>` delegate. For a plain-language request, choose
the same delegate automatically when the intent is unambiguous.

An explicit `/explain` or `interview-concept-explainer` invocation takes
precedence over coding verbs inside its topic and must finish in Concept Lab.
For explanation routes, preserve any requested duration or depth. Otherwise
provide a verbatim starting answer and ordered discussion path; never expand a
multi-part question into an exhaustive reference guide.

Do not force a route for unrelated repository work. Do not call the Playground
API directly; routed workflows use the `interview-answers playground` CLI.
