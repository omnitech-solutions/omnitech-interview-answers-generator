# packages/database/src/with-tenant.ts

_Source: `packages/database/src/with-tenant.ts` (header-comment fallback)_

[SAFETY] The only way to get a tenant-scoped Drizzle handle. The handle is
Drizzle's own transaction, typed by its relations parameter, so a nested
db.transaction() becomes a savepoint instead of committing the outer unit
of work. The tenant and actor are transaction-local settings, so row-level
security applies to every query, and a pooled connection can never carry
them into the next request.
