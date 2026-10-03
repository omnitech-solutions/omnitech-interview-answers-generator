# products/interview/src/backend/live-session/repository.test.ts

_Source: `products/interview/src/backend/live-session/repository.test.ts` (header-comment fallback)_

The owner-facing Active Session repository on a disposable PostgreSQL,
connected as the NOSUPERUSER NOBYPASSRLS member role. Covers start (same-owner
link validation, pinned profile, policy and retention, strict rehearsal, one
open session per owner, the credential helper), control authority through the
core's status machine, credential renewal and revocation, tighten-only policy,
owner delete and the owner-checked read paths.
