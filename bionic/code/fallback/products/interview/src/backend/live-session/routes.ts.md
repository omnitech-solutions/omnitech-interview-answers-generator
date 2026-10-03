# products/interview/src/backend/live-session/routes.ts

_Source: `products/interview/src/backend/live-session/routes.ts` (header-comment fallback)_

The Active Session routes (ADR-0011 Identity and Placement, ADR-0012 Read
paths and Claim and credential lookup). Two route classes share one
sub-app under /api/interview/t/:tenantSlug/sessions:

User routes (start, current, read, stream, control, credential renewal and
revocation, locality, retention, delete, screenshot download) run as the
signed-in member of the tenant the path names; the actor is the context
user and nothing in the request body or query supplies identity. A session
that is not the actor's answers exactly as one that does not exist.

The ingest route (POST .../ingest) is credential-authenticated and takes
no user session: the credential travels only in the Authorization header,
the tenant slug in the path, and every unknown, expired, revoked,
other-tenant or malformed credential gets one identical refusal.

Every response is content-free apart from the owner's own reads: errors are
fixed bodies keyed by a code, and nothing here logs (rule:id-only-traces,
rule:credential-storage, rule:bounded-ingest).
