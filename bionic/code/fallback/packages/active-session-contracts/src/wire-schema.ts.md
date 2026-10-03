# packages/active-session-contracts/src/wire-schema.ts

_Source: `packages/active-session-contracts/src/wire-schema.ts` (header-comment fallback)_

The published wire description for non-TypeScript consumers (the Swift
companion's conformance tests). It is derived from the zod schemas and never
hand-edited: `pnpm --filter @omnitech/active-session-contracts
schema:generate` rewrites it and a test fails when it drifts.
