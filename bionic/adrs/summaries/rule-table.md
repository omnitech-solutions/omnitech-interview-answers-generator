# summaries rule table

_Handle -> governing rule, projected from ADR `governs` blocks. Regenerated; edits are overwritten._

| handle | domain | rule | scope | provenance | source ADR |
|--------|--------|------|-------|------------|------------|
| ADR-0009/immutable-document-revisions | interview-documents | Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders. | products/interview revisions and exports | authored | ADR-0009 |
| ADR-0009/interview-owns-documents | interview-documents | Candidate documents, templates, revisions, and exports are owned by the Interview product. | products/interview | authored | ADR-0009 |
| ADR-0009/member-private-documents | interview-documents | Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person. | products/interview and platform artifacts | authored | ADR-0009 |
| ADR-0010/agent-profiles-write-documents | interview-documents | Any gateway language profile that declares structured generation may write documents, including the agent profiles, and an agent call runs only as a bounded read-only job in the agent worker. | apps/web ai gateway and products/interview documents | authored | ADR-0010 |
| ADR-0010/generation-limits-are-configured | interview-documents | The call cap, fields per call, tries, field length, worker concurrency and lease are deployment settings with defaults and bounds; a value out of bounds stops startup and names the setting. | products/interview documents and apps/agent-worker | authored | ADR-0010 |
| ADR-0010/generation-stops-with-its-reader | interview-documents | Generation progress reaches the page as a stream, a document is saved only when complete, and generation stops with its reader. | products/interview documents API and frontend | authored | ADR-0010 |
| ADR-0010/parallel-document-generation | interview-documents | A document is written in at most the configured number of structured calls, one call when the template fits within one call's field budget, each over contiguous model-filled fields in template order, through AiExecutionGateway against a template revision and an immutable candidate-profile revision. | products/interview/src/backend/documents | authored | ADR-0010 |
| ADR-0010/running-jobs-keep-their-lease | agent-worker | A worker renews each running job's lease, stops the agent when the lease is lost, and brings every cancel it notices to a terminal state. | apps/agent-worker | authored | ADR-0010 |

## Retired handles

_Handles a later decision displaced: dropped from the live rows above and from the resolver, retained here with their rule text so the record survives the retirement. Distinct from the removed lane above — a removal withdraws an admission a human made, a retirement displaces a rule that stays on the record._

| handle | rule | source ADR | retired by |
|--------|------|------------|------------|
| ADR-0009/structured-document-generation | Document generation uses one structured AiExecutionGateway call against a template revision and an immutable candidate-profile revision. | ADR-0009 | ADR-0010 |
