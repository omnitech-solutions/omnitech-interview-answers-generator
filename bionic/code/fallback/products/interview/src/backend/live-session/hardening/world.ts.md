# products/interview/src/backend/live-session/hardening/world.ts

_Source: `products/interview/src/backend/live-session/hardening/world.ts` (header-comment fallback)_

Shared test support for the operational hardening suites (PB-0002 slice 3).
A world is a disposable PostgreSQL migrated to head, the REAL Hono session
routes over the member role, and a way to attach a fixture companion whose
fetch is `app.request`, so every companion message crosses the real ingest
route, the real credential check and the real stores. Tests, not production
code, import this.
