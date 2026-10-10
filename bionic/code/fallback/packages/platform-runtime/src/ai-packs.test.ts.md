# packages/platform-runtime/src/ai-packs.test.ts

_Source: `packages/platform-runtime/src/ai-packs.test.ts` (header-comment fallback)_

Where prepared context is kept, decided from the environment: the engine's
database when one is named, this process's memory otherwise. No database is
opened here: the connection is a stub that records what was asked of it.
