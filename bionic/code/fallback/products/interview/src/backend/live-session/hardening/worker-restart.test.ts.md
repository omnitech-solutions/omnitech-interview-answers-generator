# products/interview/src/backend/live-session/hardening/worker-restart.test.ts

_Source: `products/interview/src/backend/live-session/hardening/worker-restart.test.ts` (header-comment fallback)_

Hardening case 2 (PB-0002 slice 3): a worker lost mid-action while the
companion keeps speaking through the real routes. The lease expires, a
successor claims at a higher fence and replays the stored observations, the
superseded worker's late publish is refused, and no draft is published twice.
