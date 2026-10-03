# summaries rule table

_Handle -> governing rule, projected from ADR `governs` blocks. Regenerated; edits are overwritten._

| handle | domain | rule | scope | provenance | source ADR |
|--------|--------|------|-------|------------|------------|
| ADR-0009/immutable-document-revisions | interview-documents | Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders. | products/interview revisions and exports | authored | ADR-0009 |
| ADR-0009/interview-owns-documents | interview-documents | Candidate documents, templates, revisions, and exports are owned by the Interview product. | products/interview | authored | ADR-0009 |
| ADR-0009/member-private-documents | interview-documents | Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person. | products/interview and platform artifacts | authored | ADR-0009 |
| ADR-0009/structured-document-generation | interview-documents | Document generation uses one structured AiExecutionGateway call against a template revision and an immutable candidate-profile revision. | products/interview generation | authored | ADR-0009 |
