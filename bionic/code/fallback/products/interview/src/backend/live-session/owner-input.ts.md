# products/interview/src/backend/live-session/owner-input.ts

_Source: `products/interview/src/backend/live-session/owner-input.ts` (header-comment fallback)_

Owner input (ADR-0016 Decision 4): the owner's own request for assistance,
"Analyze latest capture" or a typed follow-up. It is one product-owned
observation kind, `owner.input`, stored DB-side only:
- it is NOT part of the capture wire (the wire union has no such kind and
the capture credential cannot store one; ingest refuses its source
namespace, see ingest.ts);
- it has its own reserved source id, so a companion can never pre-claim
its dedup key; the request id is its event id (dedup on request id);
- it is exempt from the capture caps and rate counters, and bounded by
its own per-session cap;
- screen evidence is named by exact snapshot observation ids that must be
screen snapshots of THIS session, never bytes or paths.
Nothing here logs and no error carries content.
