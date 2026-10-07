# packages/database/src/migrate-command.test.ts

_Source: `packages/database/src/migrate-command.test.ts` (header-comment fallback)_

`pnpm db:migrate` runs as the schema owner (DATABASE_OWNER_URL, else
DATABASE_URL), never the superuser.
