# packages/database/src/connection.ts

_Source: `packages/database/src/connection.ts` (header-comment fallback)_

[SAFETY] Scopes an already-open raw transaction to a tenant (and actor)
that is only known after a query inside it — a share-token lookup, or a
bootstrap that has just created the tenant. When the tenant is known up
front, use tenantTransaction() or withTenant() instead. The settings are
transaction-local (is_local = true), so they end with the transaction and a
pooled connection never carries them into the next request; outside a
transaction they lapse at the end of this one statement. ADR-0005 keeps
this the only place outside withTenant() that sets them.
