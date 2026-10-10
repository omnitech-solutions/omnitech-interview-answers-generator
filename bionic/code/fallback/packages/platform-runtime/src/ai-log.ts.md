# packages/platform-runtime/src/ai-log.ts

_Source: `packages/platform-runtime/src/ai-log.ts` (header-comment fallback)_

The AI engine's log, in the Studio's own format. PROBLEM: the engine has a
logger of its own, and every process that builds an engine (the web server,
the agent worker's session loop, its coach, its job loop) must say the same
lines the same way, through the Studio's one logger, with the same defaults.
STRATEGY: one function turns the process's environment into the engine's
logger: the Studio's logger as its sink, the process as its context, the
mode from NODE_ENV, the level from AI_ENGINE_LOG_LEVEL, and content only
where the Studio's own switch allows it.
COMPLEXITY: O(1) to build; O(fields) per line.
[SAFETY] Content (a whole prompt, a whole answer) is the engine's two
content events only, and they are written only when the Studio's logger
allows content (LOG_CONTENT=true, read by a person: `pnpm dev`). Even then
it travels in the logger's `content` field, which the logger drops by itself
everywhere else, so rule 8 holds twice over.
