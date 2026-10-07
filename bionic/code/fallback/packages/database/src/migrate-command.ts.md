# packages/database/src/migrate-command.ts

_Source: `packages/database/src/migrate-command.ts` (header-comment fallback)_

Migrations run as the schema owner (DATABASE_OWNER_URL) when one is set: the
runtime role (DATABASE_URL) holds DML grants only and cannot run DDL. With no
owner URL, a single-role database migrates as DATABASE_URL.
