# packages/interview-contracts/src/live-session.ts

_Source: `packages/interview-contracts/src/live-session.ts` (header-comment fallback)_

The browser-facing contract of the Active Session routes
(/api/interview/t/:tenantSlug/sessions, ADR-0011 and ADR-0012). The Hono
routes and the Studio Live view both import it, so the wire shape has one
definition. It carries no identity: tenant and actor come from the signed-in
membership, never from a request body or query.

Responses are plain objects (unknown fields are stripped, so the server can
add a field without breaking an older client); requests are strict.
