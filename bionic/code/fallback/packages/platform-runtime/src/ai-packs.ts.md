# packages/platform-runtime/src/ai-packs.ts

_Source: `packages/platform-runtime/src/ai-packs.ts` (header-comment fallback)_

Where prepared context is kept (ADR-0041): the store a host gives the AI
engine as `prepared`, so a context pack a model prepared once is read by
every later request, and re-prepared only where a source changed.

PROBLEM: the web server prepares a pack and the agent worker's live coach
reads it, in two processes. STRATEGY: one decision, made from the
environment, for both. With `AI_ENGINE_DATABASE_URL` (the engine's own
database, the one that holds the record of calls) packs are kept there, in
the engine's `prepared_context` table, and any process reads them. With
none they are kept in this process's memory: a pack lasts until the
process ends and is seen only by the process that prepared it.
The Studio's own database gains no table for this.
