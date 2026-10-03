# products/interview/src/backend/live-session/session-claim.ts

_Source: `products/interview/src/backend/live-session/session-claim.ts` (header-comment fallback)_

The worker's cross-tenant claim of Active Sessions. This is the one file that
sets app.session_worker (rule:session-claim-setting; scripts/tenant-context-
boundary.test.ts). Under it the database admits SELECT of every session and
permits changing only lease and fence columns
(rule:claim-writes-lease-and-fence-only), and the claim port projects ids
only: tenant, owner and session id, plus the fence the holder was granted (a
lease token, not content). After the claim the worker acts as the owner only
in a separate actor-scoped transaction (rule:tenant-scoped-worker-access).
