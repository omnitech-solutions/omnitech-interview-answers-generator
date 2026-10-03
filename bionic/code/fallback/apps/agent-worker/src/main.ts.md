# apps/agent-worker/src/main.ts

_Source: `apps/agent-worker/src/main.ts` (header-comment fallback)_

The person's installed Codex CLI (CODEX_PATH, else `codex` on PATH): the
SDK's bundled binary can lag behind it, and a ChatGPT sign-in then refuses
current models. Falls back to the bundled binary when none is installed.
