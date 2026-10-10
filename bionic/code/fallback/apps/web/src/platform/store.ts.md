# apps/web/src/platform/store.ts

_Source: `apps/web/src/platform/store.ts` (header-comment fallback)_

The one place the shell reaches the platform's own records (users, tenants,
memberships, preferences, connected accounts). Sign-in, tenant resolution
and the integration routes ask here; none of them holds a connection or
builds a repository. Loaded on first use, so `next build` and a page that
reads nothing never open the database.
