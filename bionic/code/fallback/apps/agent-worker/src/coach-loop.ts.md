# apps/agent-worker/src/coach-loop.ts

_Source: `apps/agent-worker/src/coach-loop.ts` (header-comment fallback)_

The live coach as a worker loop: it reads the coach's transcript from the
running Studio, asks Claude Code or Codex what to tell the person, and posts
the note back as it is written. It talks to Studio as any coach does: over
its API, with the API token.

Off unless INTERVIEW_COACH names a runtime ("claude" or "codex") and the
API token is set. An agent runtime starts a process, so it runs here and
nowhere else (AGENTS.md rule 7).
