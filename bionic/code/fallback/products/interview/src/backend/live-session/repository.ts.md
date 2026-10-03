# products/interview/src/backend/live-session/repository.ts

_Source: `products/interview/src/backend/live-session/repository.ts` (header-comment fallback)_

The Active Session repository: the owner-facing lifecycle (start, control,
credential renewal and revocation, policy tightening, retention shortening,
owner delete) and the owner-checked reads. Every call opens
withTenant({tenantId, actorId, productId}) for the session OWNER, so forced
row security binds it (rule:owner-checked-read-paths). Ingest, the worker's
claim, the fenced writes and the purge are sibling modules.
