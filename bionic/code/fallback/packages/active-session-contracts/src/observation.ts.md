# packages/active-session-contracts/src/observation.ts

_Source: `packages/active-session-contracts/src/observation.ts` (header-comment fallback)_

Identity comes only from the session credential (rule:identity-from-credential),
so an observation never carries any. Every schema is strict, and
validateObservation also refuses these names explicitly with a clear path.
