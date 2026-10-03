# products/interview/src/frontend/studio/live/real-stream.test.ts

_Source: `products/interview/src/frontend/studio/live/real-stream.test.ts` (header-comment fallback)_

@vitest-environment node
REQUIRED: the Live view reads what the real backend stores. A stream page and
a capability report are produced through the real routes over a disposable
PostgreSQL (the loop-3 routes harness: Hono app.request, the member role,
forced row security), read back by the browser's own SessionClient, and fed to
the real derivations. No hand-written fixture stands in for the server, so an
envelope or shape drift (loop 3's F1: stored content is {occurredAt,
sourceSequence, body}, not the wire shape) cannot hide here.
