# packages/database/src/migrate-upgrade.test.ts

_Source: `packages/database/src/migrate-upgrade.test.ts` (header-comment fallback)_

The application owns its tables and is neither a superuser nor exempt from
row-level security, so an upgrade runs under forced RLS exactly as `pnpm dev`
and production run it. An empty database or a superuser cannot show that.
