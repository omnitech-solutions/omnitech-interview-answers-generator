# apps/web/src/platform/context.test.ts

_Source: `apps/web/src/platform/context.test.ts` (header-comment fallback)_

Outside a server render React's `cache` does not dedupe; a per-call-key
memo stands in for it so the test proves the resolver is wrapped.
