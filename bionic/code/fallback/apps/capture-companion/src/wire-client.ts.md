# apps/capture-companion/src/wire-client.ts

_Source: `apps/capture-companion/src/wire-client.ts` (header-comment fallback)_

The companion's one network seam. The transport is injected (a fetch-like
function), the credential rides only in the Authorization header, and every
message is validated against the shared wire contract before it leaves.
