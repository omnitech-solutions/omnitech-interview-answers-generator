# packages/agent-runtime-codex/src/runtime.test.ts

_Source: `packages/agent-runtime-codex/src/runtime.test.ts` (header-comment fallback)_

The Codex SDK spawns the Codex CLI and reads its JSONL thread events. This
stand-in CLI is the only fake: it answers by the scenario named in the
prompt and echoes what it was given so tests can see what the SDK passed.
