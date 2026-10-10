# packages/platform-storage/src/bootstrap.ts

_Source: `packages/platform-storage/src/bootstrap.ts` (header-comment fallback)_

`pnpm db:bootstrap`: the first user, tenant, owner membership and installed
products of a fresh database. It runs before any tenant or actor exists, on
the raw client with enterTenant, so its statements are raw upserts with
conflict targets; what it installs is data in ./bootstrap-installations.
