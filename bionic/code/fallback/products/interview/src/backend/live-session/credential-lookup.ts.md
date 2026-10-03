# products/interview/src/backend/live-session/credential-lookup.ts

_Source: `products/interview/src/backend/live-session/credential-lookup.ts` (header-comment fallback)_

Ingest's credential lookup. This is the one file that sets
app.session_credential_hash (rule:credential-lookup-policy;
scripts/tenant-context-boundary.test.ts). The named select-only policy then
admits the one live row of the route's tenant whose credential hash equals
the setting; an unknown, expired, revoked or other-tenant credential finds no
row, one refusal for all of them (rule:credential-strength). Identity comes
from the row found, and every later read or write opens a separate
actor-scoped transaction. U6 fills out the lookup query.
