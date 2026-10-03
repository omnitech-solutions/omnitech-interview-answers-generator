# apps/capture-companion/src/messages.ts

_Source: `apps/capture-companion/src/messages.ts` (header-comment fallback)_

Builders for every message the companion can emit. They take complete
bodies and add only the wire version and kind, so the corpus test can prove
each builder reproduces the shared valid messages exactly.
