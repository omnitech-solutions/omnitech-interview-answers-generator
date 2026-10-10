# products/interview/src/backend/documents/context.repository.ts

_Source: `products/interview/src/backend/documents/context.repository.ts` (header-comment fallback)_

One transaction. `onProfile` runs after the profile read and
`onCandidacy` after the candidacy read, so a missing row stops the later
reads exactly as before (they throw from the caller's check).
