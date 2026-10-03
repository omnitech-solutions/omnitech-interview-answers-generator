# products/interview/src/backend/live-session/core/dispatch.ts

_Source: `products/interview/src/backend/live-session/core/dispatch.ts` (header-comment fallback)_

Dispatch decisions (rule:idempotent-dispatch, rule:pause-end-suppression).
Key = session + logical task + task revision + action kind. A failed dispatch
records its outcome and may be retried; a succeeded or in-flight one may not.
A refusal is a suppression record carrying ids only.
