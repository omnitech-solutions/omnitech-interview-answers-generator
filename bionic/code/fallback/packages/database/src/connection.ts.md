# packages/database/src/connection.ts

_Source: `packages/database/src/connection.ts` (header-comment fallback)_

[GUARD] The one role check of this handle: every entry below awaits it
first, so no path can serve a query as a role that skips row-level
security. A handle opted in with allowRlsBypass is never checked here.
