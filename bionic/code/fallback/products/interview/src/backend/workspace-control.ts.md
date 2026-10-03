# products/interview/src/backend/workspace-control.ts

_Source: `products/interview/src/backend/workspace-control.ts` (header-comment fallback)_

The development server reloads modules independently. Keeping this small,
local-only control store on globalThis preserves commands across reloads.
