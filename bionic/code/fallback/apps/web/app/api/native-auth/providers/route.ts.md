# apps/web/app/api/native-auth/providers/route.ts

_Source: `apps/web/app/api/native-auth/providers/route.ts` (header-comment fallback)_

Public and credential-free: tells the native shell whether signing in is
possible (a real login provider, or the local sign-in of a production build
that has no development bypass), so it prompts "Sign in" only then, and which
sign-ins its panel may draw.

`configured` keeps its meaning for the shell's own prompt rule. `providers`
is the list the panel draws: the real providers, and "local" only where it is
true that Studio runs on this computer (the passwordless local sign-in is
offered to a loopback request only; see fake-auth.ts), so a panel never draws
a button that cannot work.
