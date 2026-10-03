# apps/web/app/api/integrations/[provider]/authorize/route.test.ts

_Source: `apps/web/app/api/integrations/[provider]/authorize/route.test.ts` (header-comment fallback)_

ADR-0006 D3: a missing client id or secret is an operator configuration
failure, reported as 503 before the browser is sent to the provider.
