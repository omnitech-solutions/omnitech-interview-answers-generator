# products/interview/src/backend/documents/document.service.ts

_Source: `products/interview/src/backend/documents/document.service.ts` (header-comment fallback)_

The document use cases: each loads under the member's scope, applies the
rules (document.domain.ts), asks the repository to persist, and returns the
result. No HTTP here and no SQL: the route parses and maps (api.ts), the
repository persists (repository.ts).
