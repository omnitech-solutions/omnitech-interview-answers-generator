# packages/database/src/migrate.test.ts

_Source: `packages/database/src/migrate.test.ts` (header-comment fallback)_

The expected stream is the migration folders themselves, in timestamp order:
every committed migration must have run, in order, and nothing else (like
Rails' schema_migrations against db/migrate). No list to keep in step.
