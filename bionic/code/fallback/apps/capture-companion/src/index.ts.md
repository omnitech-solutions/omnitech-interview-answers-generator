# apps/capture-companion/src/index.ts

_Source: `apps/capture-companion/src/index.ts` (header-comment fallback)_

The capture companion's platform-neutral core. The macOS app (macos/) is the
same loop in Swift; this TypeScript core is what the fixture companion and
the conformance tests run. It imports only active-session-contracts.
