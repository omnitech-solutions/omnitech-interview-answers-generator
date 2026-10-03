# products/interview/src/backend/live-session/core/tasks.ts

_Source: `products/interview/src/backend/live-session/core/tasks.ts` (header-comment fallback)_

Task state behind the injected TaskPolicy port. The policy decides what an
utterance means; this module enforces the mechanics: one logical task per
question, revisions rise only when the policy says revise, older revisions
become stale, deferred topics are kept, and non-substantive segments never
open or revise. It never inspects text (rule:id-only-traces).
