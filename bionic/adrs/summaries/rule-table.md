# summaries rule table

_Handle -> governing rule, projected from ADR `governs` blocks. Regenerated; edits are overwritten._

| handle | domain | rule | scope | provenance | source ADR |
|--------|--------|------|-------|------------|------------|
| ADR-0009/immutable-document-revisions | interview-documents | Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders. | products/interview revisions and exports | authored | ADR-0009 |
| ADR-0009/interview-owns-documents | interview-documents | Candidate documents, templates, revisions, and exports are owned by the Interview product. | products/interview | authored | ADR-0009 |
| ADR-0009/member-private-documents | interview-documents | Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person. | products/interview and platform artifacts | authored | ADR-0009 |
| ADR-0009/structured-document-generation | interview-documents | Document generation uses one structured AiExecutionGateway call against a template revision and an immutable candidate-profile revision. | products/interview generation | authored | ADR-0009 |
| ADR-0010/agreed-visible-assistance | active-session | Active Session assistance makes no undetectability claim, adds no detection evasion, and never submits, messages or operates an external interview interface. | the whole Active Session capability | authored | ADR-0010 |
| ADR-0010/fenced-current-publish | active-session | A result publishes only while its session lease fence, session status and task revision are all current. | session actions and Workspace draft publication | authored | ADR-0010 |
| ADR-0010/idempotent-observation-and-dispatch | active-session | Observations are deduplicated by source and event id, and dispatch by session, logical task, task revision and action kind. | session core and session persistence | authored | ADR-0010 |
| ADR-0010/identity-from-credential | active-session | Tenant, actor and session identity come only from a short-lived session credential, never from observation content. | active-session ingest, stream and control routes | authored | ADR-0010 |
| ADR-0010/pause-end-stop-authority | active-session | Pause or end suppresses new dispatch and rejects late publication, and only the authenticated user's session control starts, pauses or stops capture. | session processor and session control | authored | ADR-0010 |
| ADR-0010/three-concept-split | active-session | An Interview, an Active Session and an Agent Job are separate records that reference one another and never stand in for one another. | products/interview active-session persistence and services | authored | ADR-0010 |
| ADR-0010/versioned-wire-contract | active-session | The capture companion and Studio exchange only observations and commands that validate against versioned active-session-contracts schemas. | packages/active-session-contracts and apps/capture-companion | authored | ADR-0010 |
| ADR-0010/worker-hosted-processor | active-session | The session processor runs in apps/agent-worker as a separately bounded loop beside the agent-job loop, and the neutral session core imports only active-session-contracts. | apps/agent-worker and the session core | authored | ADR-0010 |
