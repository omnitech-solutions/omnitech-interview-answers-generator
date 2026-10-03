# Agent job event gateway

This service keeps browser WebSocket connections outside Next.js and renders
normalized agent-job events in the existing terminal drawer.

It does not launch Codex, Claude Code, shells, or other processes. Agent
execution belongs exclusively to `apps/agent-worker`.

Configuration:

- `TERMINAL_GATEWAY_PORT`: WebSocket port, default `3001`.
- `TERMINAL_GATEWAY_TOKEN`: optional browser connection token.
- `PLATFORM_HTTP_URL`: platform API origin, default `http://127.0.0.1:3000`.
- `AGENT_SERVICE_TOKEN`: internal token used to read job events.

Connect to `/terminal?session=<agent-job-uuid>&tenant=<tenant-uuid>`; the
platform reads a job's events only inside its tenant. The gateway resumes after the
last observed event sequence and displays normalized progress, tool, usage,
completion, and failure events.
