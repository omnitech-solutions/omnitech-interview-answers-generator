# apps/web/app/api/integrations/[provider]/authorize/route.ts

_Source: `apps/web/app/api/integrations/[provider]/authorize/route.ts` (header-comment fallback)_

The callback signs nothing and stores no token without these, so the
browser is never sent to a provider it could not come back from.
