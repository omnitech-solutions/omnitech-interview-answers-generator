# products/interview/src/backend/live-session/routes.test.ts

_Source: `products/interview/src/backend/live-session/routes.test.ts` (header-comment fallback)_

The Active Session routes through Hono's app.request on a disposable
PostgreSQL as the member role: start, ingest and stream end to end; the
owner check answering a same-tenant other user exactly as an unknown id;
one refusal for every bad ingest credential; the credential never accepted
in a URL; bounds before parsing; membership re-checked; and control state
carried on every acknowledgement (ADR-0011, ADR-0012).
