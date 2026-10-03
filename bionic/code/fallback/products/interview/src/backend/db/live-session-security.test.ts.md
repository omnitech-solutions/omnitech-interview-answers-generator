# products/interview/src/backend/db/live-session-security.test.ts

_Source: `products/interview/src/backend/db/live-session-security.test.ts` (header-comment fallback)_

Active Session persistence on a disposable PostgreSQL, connected as the
NOSUPERUSER NOBYPASSRLS member role (the application's role), as in
documents-security.test.ts. The fixture owner is a superuser and is used only
to arrange rows. Covers ADR-0012's database-level rules: actor-private rows,
composite owner references, linked-resource authorization, immutable and
monotonic columns, no content after purging, the claim, the credential lookup,
the purge delete setting, private session artifacts and the tombstone.
