# packages/database/src/migration-check.ts

_Source: `packages/database/src/migration-check.ts` (header-comment fallback)_

The boot-time pending-migration check (Rails refuses to boot with pending
migrations; Nest's database module validates at bootstrap). Migrations are a
separate deploy step (`pnpm db:migrate`) and never run at app start. The
expected stream is embedded (migration-names.ts) because bundled apps cannot
read the drizzle folder; scripts guard its freshness. Messages carry only
migration folder names: no SQL, connection string or data.
