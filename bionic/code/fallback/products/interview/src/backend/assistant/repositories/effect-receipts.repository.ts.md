# products/interview/src/backend/assistant/repositories/effect-receipts.repository.ts

_Source: `products/interview/src/backend/assistant/repositories/effect-receipts.repository.ts` (header-comment fallback)_

Idempotent effect receipts (`interview.assistant_effect_receipts`):
persistence only.
Each function runs one statement on the transaction the workspace service
opened and bound, and returns its rows; what a missing or stale row means is the service's rule.
