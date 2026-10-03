# products/interview/src/backend/live-session/ingest.ts

_Source: `products/interview/src/backend/live-session/ingest.ts` (header-comment fallback)_

Ingest: one credential-authenticated message (an observation or a heartbeat)
from the capture companion. Identity comes only from the credential
(rule:identity-from-credential): the credential's hash resolves the ONE
session, and every later read or write runs in a tenant-and-actor transaction
for that session's owner. A failed lookup is one refusal (rule:credential-
strength); membership is re-verified before any domain write
(rule:ingest-membership-recheck); bounds are enforced before anything is
written (rule:bounded-ingest); a resend returns the ORIGINAL stored
acknowledgement (rule:idempotent-observation). Nothing here logs, and no
refusal carries content: codes, paths and control state only.
