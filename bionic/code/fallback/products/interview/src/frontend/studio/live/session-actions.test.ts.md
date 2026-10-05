# products/interview/src/frontend/studio/live/session-actions.test.ts

_Source: `products/interview/src/frontend/studio/live/session-actions.test.ts` (header-comment fallback)_

The in-flight guard dedupes an IDENTICAL request only (same session, task
target and text): a different follow-up is its own request and is never
dropped while another is pending.
