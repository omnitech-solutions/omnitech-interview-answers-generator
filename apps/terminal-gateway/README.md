# Terminal gateway

This package is the persistent Node.js terminal service used by the browser
terminal. It must run outside Next.js so the WebSocket connection, PTY, and
tmux process remain alive.

```bash
pnpm dev
```

The gateway listens on `ws://127.0.0.1:3001/terminal`, starts in the detected
repository root, and attaches every browser connection to the shared tmux
session named `workspace`. Concept Lab adds a validated `session=concept-*`
query parameter so its terminal can attach to the isolated Codex session.

Set `TERMINAL_GATEWAY_TOKEN` to require a matching `token` query parameter and
`INTERVIEW_PROJECT_ROOT` to override root detection.

Concept Lab also uses `POST /concept-sessions` to start a fresh detached tmux
session containing `codex "/explain <topic>"`. When a token is configured, this
endpoint requires `Authorization: Bearer <token>`. It accepts only a concept
topic and does not expose arbitrary shell execution.
