# products/interview/src/backend/brief/routes.ts

_Source: `products/interview/src/backend/brief/routes.ts` (header-comment fallback)_

The interview brief's routes, registered on the documents API so they sit
behind its guard (the signed-in member of the tenant the request names, the
write permission and same-origin check on every write) and under its
prefix: /api/interview/documents/candidacies/:id/…

PROBLEM: one application's stages, transcripts, employer-said entries and
research must be read and edited whole by its owner. STRATEGY: each route
parses its body against the contract (every size is bounded there) and
hands it to the brief's service, which opens one tenant transaction and lets
the repository settle ownership first.
[SAFETY] A refusal is a code alone. Nothing a person typed, uploaded or
recorded is ever logged or echoed in an error.
