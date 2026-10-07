# packages/database/src/role-split.test.ts

_Source: `packages/database/src/role-split.test.ts` (header-comment fallback)_

The owner/runtime role split (ADR-0005 d4): `omnitech_owner` owns the schemas
and migrates; `omnitech` has USAGE and DML only, so a compromised app cannot
disable its own row-level security. docker/postgres/ensure-roles.sql is the
one idempotent step that creates both (fresh volume) or upgrades a database
the runtime role used to own (existing volume).
