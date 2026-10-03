# apps/web/src/platform/ai-config.test.ts

_Source: `apps/web/src/platform/ai-config.test.ts` (header-comment fallback)_

ADR-0007 Decision 4: a profile's bounds are pinned to its version. A
change to any bound here without bumping that profile's version fails, so
every job snapshot names the exact revision it ran under. Only the model
name comes from the environment, so it is left out of the pin.
