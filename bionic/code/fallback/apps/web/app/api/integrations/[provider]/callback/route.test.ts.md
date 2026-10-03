# apps/web/app/api/integrations/[provider]/callback/route.test.ts

_Source: `apps/web/app/api/integrations/[provider]/callback/route.test.ts` (header-comment fallback)_

ADR-0006 D3: the callback shares the provider configuration, so a missing
client id or secret is the same 503, before any code exchange or redirect.
