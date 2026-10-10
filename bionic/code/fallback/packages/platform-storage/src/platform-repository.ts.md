# packages/platform-storage/src/platform-repository.ts

_Source: `packages/platform-storage/src/platform-repository.ts` (header-comment fallback)_

People, sign-in identities, preferences, connected accounts and a tenant's
installed products. What a context grants is decided in ./platform-context.
Raw by necessity: users, identities, preferences and connected accounts are
not tenant-owned and a context's tenant is known only after its first read,
while the database package hands out a Drizzle handle only for a known
tenant and actor (withTenant). The upserts name their conflict targets.
