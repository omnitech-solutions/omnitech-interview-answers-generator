# apps/web/src/platform/settings.ts

_Source: `apps/web/src/platform/settings.ts` (header-comment fallback)_

The host settings the shell's own server modules read from the environment,
in one place. Read when asked, never at import: `next build` has no secrets,
and a test sets them per case.

[SAFETY] NODE_ENV and NEXT_PUBLIC_* are read literally, so a Next build
replaces them with the same constants here as everywhere else. The sign-in
rules (auth-settings.ts, fake-auth.ts) and the engine's model configuration
(ai.ts) keep their own reads beside the rules that explain them.
