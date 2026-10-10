# products/presentation/src/backend/api.ts

_Source: `products/presentation/src/backend/api.ts` (header-comment fallback)_

The presentation API: Hono wiring and transport only. Each route reads the
member, parses its body against contracts.ts, delegates to application/ and
answers; what a failure says is the route's row of data, not a branch.
