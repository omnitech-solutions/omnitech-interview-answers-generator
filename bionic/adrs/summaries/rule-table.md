# summaries rule table

_Handle -> governing rule, projected from ADR `governs` blocks. Regenerated; edits are overwritten._

| handle | domain | rule | scope | provenance | source ADR |
|--------|--------|------|-------|------------|------------|
| ADR-0009/immutable-document-revisions | interview-documents | Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders. | products/interview revisions and exports | authored | ADR-0009 |
| ADR-0009/interview-owns-documents | interview-documents | Candidate documents, templates, revisions, and exports are owned by the Interview product. | products/interview | authored | ADR-0009 |
| ADR-0009/member-private-documents | interview-documents | Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person. | products/interview and platform artifacts | authored | ADR-0009 |
| ADR-0009/structured-document-generation | interview-documents | Document generation uses one structured AiExecutionGateway call against a template revision and an immutable candidate-profile revision. | products/interview generation | authored | ADR-0009 |
| ADR-0010/credential-ingest-scope | active-session | The session credential grants ingest for one session only and has a short hard maximum lifetime. | active-session credential minting and ingest | authored | ADR-0010 |
| ADR-0010/credential-storage | active-session | The session credential is stored hashed and is never logged or placed in a URL. | active-session credential storage and logging | authored | ADR-0010 |
| ADR-0010/fast-path-no-tools | active-session | The fast-path model call has no tools. | session processor fast path | authored | ADR-0010 |
| ADR-0010/fenced-current-publish | active-session | A result publishes only while its session lease fence, session status and task revision are all current. | session actions and Workspace draft publication | authored | ADR-0010 |
| ADR-0010/idempotent-dispatch | active-session | Dispatch is deduplicated by session, logical task, task revision and action kind. | session core and session persistence | authored | ADR-0010 |
| ADR-0010/idempotent-observation | active-session | Observations are deduplicated by source and event id. | session core and session persistence | authored | ADR-0010 |
| ADR-0010/identity-from-credential | active-session | Ingest identity comes only from the session credential, and stream and control identity only from the user's session, never from request or observation content. | active-session ingest, stream and control routes | authored | ADR-0010 |
| ADR-0010/loop-isolation | active-session | A failure in one worker loop never stops the other. | apps/agent-worker | authored | ADR-0010 |
| ADR-0010/neutral-core-imports | active-session | The session core imports only active-session-contracts. | the session core directory in products/interview, named in the boundary test | authored | ADR-0010 |
| ADR-0010/no-external-interface-operation | active-session | Active Session assistance never submits, messages or operates an external interview interface. | the whole Active Session capability | authored | ADR-0010 |
| ADR-0010/no-promotion | active-session | Session output and transcript content are never written into the experience matrix or exercise catalogue. | session actions, Workspace publication and interview policy | authored | ADR-0010 |
| ADR-0010/no-undetectability-or-evasion | active-session | Active Session assistance makes no undetectability claim and adds no detection evasion. | the whole Active Session capability | authored | ADR-0010 |
| ADR-0010/pause-end-suppression | active-session | Pause or end refuses new dispatch and cancels the session's in-flight jobs. | session processor | authored | ADR-0010 |
| ADR-0010/stop-authority | active-session | Only the authenticated user's session control starts or resumes capture; only that control, credential expiry or the companion's local stop ends it. | session control and capture companion | authored | ADR-0010 |
| ADR-0010/structured-field-decisions | active-session | Job, retrieval and publish decisions come only from validated structured fields. | session processor and interview policy | authored | ADR-0010 |
| ADR-0010/tenant-scoped-worker-access | active-session | The worker reads and writes session data only inside a tenant-scoped transaction after a minimal cross-tenant claim. | session processor persistence access | authored | ADR-0010 |
| ADR-0010/three-concept-split | active-session | An Interview, an Active Session and an Agent Job are separate records. | products/interview active-session persistence and services | authored | ADR-0010 |
| ADR-0010/versioned-wire-contract | active-session | The companion and Studio exchange only versioned active-session-contracts schemas. | packages/active-session-contracts and apps/capture-companion | authored | ADR-0010 |
| ADR-0010/worker-hosted-processor | active-session | The session processor runs in apps/agent-worker as its own loop beside the agent-job loop. | apps/agent-worker | authored | ADR-0010 |
