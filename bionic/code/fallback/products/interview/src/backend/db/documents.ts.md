# products/interview/src/backend/db/documents.ts

_Source: `products/interview/src/backend/db/documents.ts` (header-comment fallback)_

Candidate documents live in Interview. The UUID scope matches the core
candidacy and platform-artifact tables; legacy profile keys are text and are
verified in the same tenant transaction before a document is inserted.
