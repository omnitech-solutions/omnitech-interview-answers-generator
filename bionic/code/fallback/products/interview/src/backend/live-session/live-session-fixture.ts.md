# products/interview/src/backend/live-session/live-session-fixture.ts

_Source: `products/interview/src/backend/live-session/live-session-fixture.ts` (header-comment fallback)_

Shared test fixture for the Active Session repository layer: a disposable
PostgreSQL migrated to head, the NOSUPERUSER NOBYPASSRLS member role (the
application's role) as the connection under test, and a fixture owner used
only to arrange rows. Tests, not production code, import this.
