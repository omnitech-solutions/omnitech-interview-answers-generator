# packages/database/src/with-tenant.test.ts

_Source: `packages/database/src/with-tenant.test.ts` (header-comment fallback)_

Sequential transactions reuse the pool's single idle connection, which
is exactly the reuse the leak test needs.
