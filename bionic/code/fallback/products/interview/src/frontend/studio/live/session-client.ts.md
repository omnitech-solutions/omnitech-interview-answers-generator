# products/interview/src/frontend/studio/live/session-client.ts

_Source: `products/interview/src/frontend/studio/live/session-client.ts` (header-comment fallback)_

Typed browser calls to the Active Session routes
(/api/interview/t/:tenantSlug/sessions). Every response is parsed with the
shared contract schemas, and every failure becomes a SessionApiError whose
code is one of the closed LIVE_SESSION_ERROR_CODES or a transport code. An
error never carries the response body or any session content
(rule:id-only-traces): a code is all a screen may show.
