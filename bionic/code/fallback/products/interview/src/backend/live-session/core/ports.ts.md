# products/interview/src/backend/live-session/core/ports.ts

_Source: `products/interview/src/backend/live-session/core/ports.ts` (header-comment fallback)_

Ports the neutral session core needs from its host (rule:neutral-core-imports).
The product supplies implementations; the core never reaches for I/O, time or
randomness itself, and never decides what an utterance means.
