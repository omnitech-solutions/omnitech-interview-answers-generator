# products/interview/src/backend/brief/repository.ts

_Source: `products/interview/src/backend/brief/repository.ts` (header-comment fallback)_

The interview brief's storage (BRIEF-interview-brief-and-context-pack,
section 3): an application's stages with their people, notes, transcripts
and outcome, what the employer said, and the research documents.

PROBLEM: one application's whole brief must be read and edited by the member
it belongs to and by nobody else. STRATEGY: every function takes the
tenant-scoped handle of a transaction opened by `withTenant` (so forced
row-level security binds every statement, ADR-0005) and first settles that
the application is the member's own; an application that is not answers
exactly as one that does not exist. Everything is the query builder
(ADR-0023): there is no raw statement here.
