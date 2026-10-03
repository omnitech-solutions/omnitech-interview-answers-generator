# packages/agent-runtime-codex/src/index.ts

_Source: `packages/agent-runtime-codex/src/index.ts` (header-comment fallback)_

The worker runs each job in a fresh, isolated temporary directory,
never a repository, so Codex's trusted-repository check cannot pass.
