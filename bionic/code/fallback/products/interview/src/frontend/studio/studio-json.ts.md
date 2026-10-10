# products/interview/src/frontend/studio/studio-json.ts

_Source: `products/interview/src/frontend/studio/studio-json.ts` (header-comment fallback)_

Read once; malformed successful JSON remains a failure, while an HTML
proxy error still carries its HTTP status through StudioRequestError.
