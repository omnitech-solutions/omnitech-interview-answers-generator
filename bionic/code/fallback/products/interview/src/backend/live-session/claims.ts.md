# products/interview/src/backend/live-session/claims.ts

_Source: `products/interview/src/backend/live-session/claims.ts` (header-comment fallback)_

Per-claim source verification for session answers (ADR-0011 rule:no-promotion,
plan #2 D2/D3). The model returns claims; this module verifies what it
returned against the pinned context snapshot and nothing else. It never
searches other snapshot entries to rescue a claim: a reference either
supports the claim it is attached to or the claim is rejected.

Output is PATH:CODE strings only. A violation never copies a claim, quote or
any other model-controlled string (rule:id-only-traces).
