# apps/web/src/platform/api-safety.ts

_Source: `apps/web/src/platform/api-safety.ts` (header-comment fallback)_

[DOMAIN] Two rules every `/api/*` route shares, so no sub-app has to repeat
them: where a mutating request may come from, and what an unexpected error
says.
