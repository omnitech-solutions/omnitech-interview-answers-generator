# products/interview/src/backend/assistant/repositories/drafts.repository.ts

_Source: `products/interview/src/backend/assistant/repositories/drafts.repository.ts` (header-comment fallback)_

Workspace drafts, what an applied proposal replaced, and saved answer
revisions: persistence only.
Each function runs one statement on the transaction the workspace service
opened and bound, and returns its rows; what a missing or stale row means is the service's rule.
