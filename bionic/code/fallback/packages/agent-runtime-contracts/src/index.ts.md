# packages/agent-runtime-contracts/src/index.ts

_Source: `packages/agent-runtime-contracts/src/index.ts` (header-comment fallback)_

BACKEND-ONLY: this package uses node:fs (attachment path checks), so it is
imported by workers, runtimes and server code and never by a frontend or
browser bundle. Types that a client needs belong in a separate contracts
package, not here.
