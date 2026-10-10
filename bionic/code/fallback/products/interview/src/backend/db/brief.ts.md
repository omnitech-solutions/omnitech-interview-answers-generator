# products/interview/src/backend/db/brief.ts

_Source: `products/interview/src/backend/db/brief.ts` (header-comment fallback)_

The interview brief's own tables (BRIEF-interview-brief-and-context-pack,
section 3): a stage's transcripts, what the employer said, and the research
documents of a company or an application. A stage's people stay in
`interview_participants`/`people`, and its notes and outcome are columns of
`interviews` (schema.ts).

[SAFETY] All three hold a person's private content, so each row belongs to
the member who wrote it: forced row-level security pins a row to its tenant
AND its owner (ADR-0005), and every reference to another tenant-owned row is
composite on (tenant_id, id). Another member of the same workspace reads
nothing here.
