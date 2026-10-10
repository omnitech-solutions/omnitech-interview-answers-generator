# products/interview/src/backend/live-session/repositories/capability.repository.ts

_Source: `products/interview/src/backend/live-session/repositories/capability.repository.ts` (header-comment fallback)_

Persistence of the capture companion's latest self-reported readiness for
its owner (capability.report, ADR-0012 Locality by stage). One row per
(tenant, owner) under forced row security binding tenant AND actor: the
actor is the session owner on the ingest write and the signed-in member on
the browser read, so another member of the same workspace never reads or
replaces it. The row is device capability, never content: states and a
language tag only. Nothing here logs.
