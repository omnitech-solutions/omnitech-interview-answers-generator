# products/interview/src/frontend/studio/live/session-reactive.test.ts

_Source: `products/interview/src/frontend/studio/live/session-reactive.test.ts` (header-comment fallback)_

Reactive by design: a pause or resume shows at once and reconciles with the
server, a refusal puts the old state back, and "can't reach Studio" is said
only after a real run of failed reads, never for one blip.
