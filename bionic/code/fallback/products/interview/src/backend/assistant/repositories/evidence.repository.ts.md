# products/interview/src/backend/assistant/repositories/evidence.repository.ts

_Source: `products/interview/src/backend/assistant/repositories/evidence.repository.ts` (header-comment fallback)_

Evidence sources (`interview.assistant_evidence`): persistence only.
Each function runs one statement on the transaction the workspace service
opened and bound, and returns its rows; what a missing or stale row means is the service's rule.
