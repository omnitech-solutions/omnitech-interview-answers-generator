# products/interview/src/backend/behaviour-flags.ts

_Source: `products/interview/src/backend/behaviour-flags.ts` (header-comment fallback)_

[DOMAIN] What Settings stored for the behaviour flags (the registry is
BEHAVIOUR_FLAGS in the contracts). The flags are this machine's, as their
environment variables are, so like the coach's plan they are kept in one
small file in the data directory, beside it: no table, and nothing per
tenant. The environment still wins over what is here (see the registry).

[SAFETY] The file holds flag names and values from closed lists only: never
content, never a secret. A value outside a flag's list is not kept.
