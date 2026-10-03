# products/interview/src/backend/live-session/core/lease.ts

_Source: `products/interview/src/backend/live-session/core/lease.ts` (header-comment fallback)_

Lease and fence model (rule:fenced-current-publish; ADR-0011 Fencing). A
per-session counter fence rises on every acquire, so a restarted or slow
worker holding an older fence can never publish over its successor.
