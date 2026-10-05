# packages/active-session-contracts/src/control.test.ts

_Source: `packages/active-session-contracts/src/control.test.ts` (header-comment fallback)_

Conformance for the strict-reader hazard (ADR-0020). LEGACY_CONTROL is the
control object exactly as the companion read it before capture requests: a
strict reader. The new field is not readable by it, which is why Studio
emits it only to a companion that declared the feature.
