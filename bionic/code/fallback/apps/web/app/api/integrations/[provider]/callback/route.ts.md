# apps/web/app/api/integrations/[provider]/callback/route.ts

_Source: `apps/web/app/api/integrations/[provider]/callback/route.ts` (header-comment fallback)_

[SAFETY] The verifier cookie is cleared on every outcome that got as far as
reading it, so the same callback URL cannot be replayed.
