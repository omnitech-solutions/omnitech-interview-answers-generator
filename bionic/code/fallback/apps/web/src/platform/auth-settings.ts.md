# apps/web/src/platform/auth-settings.ts

_Source: `apps/web/src/platform/auth-settings.ts` (header-comment fallback)_

[DOMAIN] The two Auth.js settings that depend on where the server runs.
Both read an environment passed in (the process's by default) when called,
never at import, so `next build`, which has no AUTH_SECRET, cannot fail here.
