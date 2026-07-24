# Terminal gateway

This package is the persistent Node.js terminal service used by the browser
terminal. It must run outside Next.js so the WebSocket connection, PTY, and
tmux process remain alive.

```bash
pnpm dev
```

The gateway listens on `ws://127.0.0.1:3001/terminal`, starts in the detected
repository root, and attaches every browser connection to the shared tmux
session named `workspace`.

Set `TERMINAL_GATEWAY_TOKEN` to require a matching `token` query parameter and
`INTERVIEW_PROJECT_ROOT` to override root detection.
