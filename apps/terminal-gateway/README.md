# Terminal gateway

This package is the persistent Node.js terminal service used by the browser
terminal. It must run outside Next.js so the WebSocket connection, PTY, and
tmux process remain alive.

```bash
pnpm dev
```

The gateway listens on `ws://127.0.0.1:3001/terminal`, starts in the detected
repository root, and attaches every browser connection to the shared tmux
session named `workspace`. Concept Lab and the Playground add validated
`session=concept-*` and `session=answer-*` query parameters so their terminals
can attach to the latest isolated Codex session.

Set `TERMINAL_GATEWAY_TOKEN` to require a matching `token` query parameter and
`INTERVIEW_PROJECT_ROOT` to override root detection.

Concept Lab uses `POST /concept-sessions` for concise explanation generation.
The coding Playground uses `POST /answer-sessions` to show `/answer <question>`
in an isolated terminal while a single ephemeral, schema-constrained Codex call
generates and atomically publishes the solution, usage, and tests. This avoids
the slower interactive file/tool workflow. When a token is configured, both
endpoints require `Authorization: Bearer <token>` and accept only their typed
input.
