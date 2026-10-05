# apps/web/app/api/native-auth/complete/route.ts

_Source: `apps/web/app/api/native-auth/complete/route.ts` (header-comment fallback)_

Auth.js lands here after the provider, inside the web-auth session. The
callback URL carries a one-time handoff code and nothing else: never the
session token, and no provider token.
