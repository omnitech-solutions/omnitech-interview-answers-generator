# doctrine — current beliefs, per governs domain

_The per-domain view of what the project currently holds to be true, compiled deterministically from the summaries projection and reconciled against the ratified invariants. Doctrine is the primary read surface for a current-belief question; it holds zero authority, and the ADR body is the record on any disagreement. Regenerated; edits are overwritten._

_State legend: **believed** (every applicable invariant reconciles) · **backfilled** (admitted via the historic backfill, no applicable invariant) · **no-applicable-invariant** (a prospective rule no ratified invariant references) · **BROKEN** (an un-adjudicated, digest-stale, or collision pairing — the belief is withheld until a human reconciles)._

_Basis legend — the mechanical fact measured behind each rule: **run-bound** (a run snapshot's artifacts reference this rule's source ADR) · **not-run-bound** (no run snapshot does) · **evidence-resolves** (the observation record names at least one evidence path and every one resolves on disk) · **evidence-missing** (a named evidence path does not resolve, or the record names none). No basis value is evidence that the rule holds: each says which fact was measured, and none of them measures the rule._

## active-session — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0011/credential-ingest-scope | rule:credential-ingest-scope | The session credential grants ingest for one session only and has a short hard maximum lifetime. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/credential-storage | rule:credential-storage | The session credential is stored hashed and is never logged or placed in a URL. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/fast-path-no-tools | rule:fast-path-no-tools | The fast-path model call has no tools. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/fenced-current-publish | rule:fenced-current-publish | A result publishes only while its session lease fence, session status and task revision are all current. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/idempotent-dispatch | rule:idempotent-dispatch | Dispatch is deduplicated by session, logical task, task revision and action kind. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/idempotent-observation | rule:idempotent-observation | Observations are deduplicated by source and event id. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/identity-from-credential | rule:identity-from-credential | Ingest identity comes only from the session credential, and stream and control identity only from the user's session, never from request or observation content. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/loop-isolation | rule:loop-isolation | A failure in one worker loop never stops the other. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/neutral-core-imports | rule:neutral-core-imports | The session core imports only active-session-contracts. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/no-external-interface-operation | rule:no-external-interface-operation | Active Session assistance never submits, messages or operates an external interview interface. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/no-promotion | rule:no-promotion | Session output and transcript content are never written into the experience matrix or exercise catalogue. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/no-undetectability-or-evasion | rule:no-undetectability-or-evasion | Active Session assistance makes no undetectability claim and adds no detection evasion. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/pause-end-suppression | rule:pause-end-suppression | Pause or end refuses new dispatch and cancels the session's in-flight jobs. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/structured-field-decisions | rule:structured-field-decisions | Job, retrieval and publish decisions come only from validated structured fields. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/tenant-scoped-worker-access | rule:tenant-scoped-worker-access | The worker reads and writes session data only inside a tenant-scoped transaction after a minimal cross-tenant claim. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/three-concept-split | rule:three-concept-split | An Interview, an Active Session and an Agent Job are separate records. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/versioned-wire-contract | rule:versioned-wire-contract | The companion and Studio exchange only versioned active-session-contracts schemas. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0011/worker-hosted-processor | rule:worker-hosted-processor | The session processor runs in apps/agent-worker as its own loop beside the agent-job loop. | ADR-0011 | Accepted | decided | run-bound |
| ADR-0013/advisory-capability-report | rule:advisory-capability-report | The stored companion capability report is advisory: it never blocks a session start and no server decision reads it. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0013/offline-local-stop | rule:offline-local-stop | The owner's local stop on the capture companion stops capture and drops its buffers without waiting for Studio; any farewell call is best effort. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0013/outage-never-stops-capture | rule:outage-never-stops-capture | A Studio outage alone never stops capture on the capture companion. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0013/owner-or-cap-ends | rule:owner-or-cap-ends | Only the owner's session control, an owner delete or the duration cap ends a session. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0013/owner-starts-and-resumes | rule:owner-starts-and-resumes | Only the owner's session control starts or resumes a session. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0013/pause-only-credential-stop | rule:pause-only-credential-stop | An expired, revoked or missing credential, a heartbeat reporting `capturing: false`, or silence past the heartbeat limit after prior contact pauses an active session and never ends it. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0016/one-store-many-presentations | rule:one-store-many-presentations | Full, Focus, and floating views present one session store; the floating view is read-only, never controls the session, and closes on access loss. | ADR-0016 | Accepted | decided | run-bound |
| ADR-0016/owner-input-not-capture | rule:owner-input-not-capture | Owner input is a DB-only observation kind the capture wire cannot send, with its own source namespace, outside capture caps. | ADR-0016 | Accepted | decided | run-bound |
| ADR-0016/screenshot-attachments-fail-closed | rule:screenshot-attachments-fail-closed | A screenshot reaches a provider only as an owner-scoped, frozen, size- and dimension-bounded attachment on a runtime whose image input a test proves; otherwise the action is refused, never answered text-only. | ADR-0016 | Accepted | decided | run-bound |
| ADR-0016/two-action-slots-fenced | rule:two-action-slots-fenced | Short assistance and coding hold separate slots, each with its own action, abort signal, and handle; a superseded revision is cancelled and its result is never published. | ADR-0016 | Accepted | decided | run-bound |
| ADR-0016/worker-local-tool-less-inference | rule:worker-local-tool-less-inference | Session actions reach agents only through the gateway's existing AgentExecutionPort, tool-less and structured; a runtime that cannot prove tool-less operation is refused, and Next.js never launches an agent. | ADR-0016 | Accepted | decided | run-bound |

## active-session-locality — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0012/declared-profile-locality | rule:declared-profile-locality | Every AI profile declares its locality in the shared profile configuration source, and a missing or unknown value is treated as remote. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/device-only-enforced-twice | rule:device-only-enforced-twice | A device-only session uses only device-locality profiles, enforced at profile resolution and again before dispatch, with no fallback. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/model-calls-gateway-routed | rule:model-calls-gateway-routed | Every model call carrying session content goes through the gateway with the session policy. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/session-processing-policy | rule:session-processing-policy | A session records its processing policy at start, and only the session row decides it. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/tighten-only-locality | rule:tighten-only-locality | A session may tighten its processing policy to device-only but never loosen it. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/unlisted-stage-refused | rule:unlisted-stage-refused | A stage with no device implementation is refused in device-only mode. | ADR-0012 | Accepted | decided | run-bound |

## active-session-privacy — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0012/action-before-job | rule:action-before-job | A session action and its pre-generated job id are committed before the job is created, and job creation is idempotent on that id. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/actor-private-session-rows | rule:actor-private-session-rows | Active Session tables are owned by products/interview and carry tenant and owner ids under forced row security that binds both. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/bounded-ingest | rule:bounded-ingest | Ingest refuses over-limit content with a content-free outcome and writes nothing. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/captured-input-untrusted | rule:captured-input-untrusted | Captured text, images and pre-loaded role text are untrusted data that cannot grant tools, change policy, request secrets or override allowed actions. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/claim-writes-lease-and-fence-only | rule:claim-writes-lease-and-fence-only | Under the session claim setting the database permits changing only lease and fence columns. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/composite-owner-references | rule:composite-owner-references | Every table that references a session does so by tenant, owner and session id. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/credential-held-securely | rule:credential-held-securely | The companion holds the credential only in the keychain or memory. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/credential-lifetime-and-renewal | rule:credential-lifetime-and-renewal | The session credential expires no later than the session duration cap and extends only by owner-initiated replacement. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/credential-lookup-policy | rule:credential-lookup-policy | A named policy admits only the one session row whose credential hash is presented, after which access is tenant-and-actor scoped. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/credential-revocation | rule:credential-revocation | The session credential is revoked on end, purge, membership removal or owner request. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/credential-strength | rule:credential-strength | The session credential is at least 128 random bits, and a failed lookup gives one refusal whether the credential is unknown, expired or revoked. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/id-only-traces | rule:id-only-traces | Traces and logs hold ids, revisions, profiles, durations, outcomes, byte counts and validation paths, never content, credentials or content hashes. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/immutable-privacy-columns | rule:immutable-privacy-columns | The database refuses changing a session's tenant, owner, rehearsal run id, strict flag, links or sources snapshot once set at start, except setting links, snapshot and credential to null while the session is purging. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/inert-draft-rendering | rule:inert-draft-rendering | Session-authored drafts render without fetching external resources. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/ingest-membership-recheck | rule:ingest-membership-recheck | Ingest rechecks tenant membership before any domain write. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/job-creation-locked-to-session | rule:job-creation-locked-to-session | Job creation for a session verifies under a lock on the session row that it is active with a current fence, and cancellation fails closed on a job it cannot see. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/linked-resource-authorization | rule:linked-resource-authorization | A session may link an interview, candidacy, profile revision, Workspace draft, agent job or artifact only after the database confirms the same tenant and owner. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/monotonic-privacy-columns | rule:monotonic-privacy-columns | The database refuses loosening the processing policy and lengthening retention. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/no-content-after-purging | rule:no-content-after-purging | The database refuses new observations, screenshot artifacts and published results for a session that is ended or purging. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/no-resume-after-end | rule:no-resume-after-end | A session job is resumed only after verifying under the session-row lock that its session, found through the action naming the job, is active. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/owner-checked-read-paths | rule:owner-checked-read-paths | Every session read path opens an actor-scoped transaction for the session owner. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/owner-chooses-retention | rule:owner-chooses-retention | Only the session owner chooses or shortens retention. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/private-session-artifact-types | rule:private-session-artifact-types | Every session artifact type is covered by the artifact owner-only policies. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/private-session-jobs | rule:private-session-jobs | A job created by a session is visible and cancellable only by its creator and the agent worker. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/purge-delete-setting | rule:purge-delete-setting | Deleting session artifacts requires a named setting with one owning file, plus matching owner and session artifact type. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/raw-audio-never-persisted | rule:raw-audio-never-persisted | Raw audio is held only in a bounded companion memory buffer and is never sent, stored or logged. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/retention-modes | rule:retention-modes | Retention is delete at end, thirty days from end, or until deleted, defaulting to delete at end. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/screenshots-as-private-artifacts | rule:screenshots-as-private-artifacts | Selected screenshots live only as owner-private image artifacts with payloads, checked by leading bytes and served inert. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/session-claim-setting | rule:session-claim-setting | The session worker claims sessions across tenants through one named setting with one owning file listed in the tenant-context-boundary test (scripts/tenant-context-boundary.test.ts). | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/transcripts-in-observations | rule:transcripts-in-observations | Final transcript text lives only in session observation rows. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0013/complete-purge-except-retained-drafts | rule:complete-purge-except-retained-drafts | A session purge deletes its observations, actions, jobs, payloads, relay rows and other session records, with retained Workspace drafts that may contain captured session content as the explicit exception. | ADR-0013 | Accepted | decided | run-bound |
| ADR-0013/purge-keeps-adopted-drafts | rule:purge-keeps-adopted-drafts | The purge deletes a session-created draft only while it is unchanged since the session last published it and no saved answer revision or revert record names it; retained drafts may contain session content. | ADR-0013 | Accepted | decided | run-bound |

## active-session-rehearsal — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0012/assistance-counts-as-hints | rule:assistance-counts-as-hints | In a non-strict rehearsal each shown assistance draft counts as a hint at the existing hint cost, keyed by the rehearsal run id. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/no-second-scorecard | rule:no-second-scorecard | A session never writes a Rehearsal scorecard. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/strict-rehearsal-no-assistance | rule:strict-rehearsal-no-assistance | Live assistance is disabled in a strict rehearsal. | ADR-0012 | Accepted | decided | run-bound |
| ADR-0012/tombstone-keeps-hint-count | rule:tombstone-keeps-hint-count | The tombstone keeps owner, rehearsal run id, strict flag and a content-free count of shown drafts. | ADR-0012 | Accepted | decided | run-bound |

## agent-runtime — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0014/claude-supported-lifecycle | rule:claude-supported-lifecycle | Claude uses only the installed TypeScript Agent SDK's supported session lifecycle; isolated structured jobs remain one-shot, and persistent sessions require measured benefit and safe closure. | ADR-0014 | Accepted | decided | run-bound |
| ADR-0014/codex-transport-parity | rule:codex-transport-parity | Codex App Server may replace the SDK only through worker-owned private stdio, with a pinned protocol, parity checks, and a measured same-workload benefit. | ADR-0014 | Accepted | decided | run-bound |
| ADR-0014/fenced-terminal-publish | rule:fenced-terminal-publish | Each closing event, matching job status, and applicable result reference commit atomically under a claim fence or row lock; a lost claim publishes nothing further. | ADR-0014 | Accepted | decided | run-bound |
| ADR-0014/one-terminal-outcome | rule:one-terminal-outcome | Each logical execution publishes exactly one terminal outcome; each claimed attempt publishes at most one closing outcome, including an awaiting-input suspension. | ADR-0014 | Accepted | decided | run-bound |
| ADR-0014/provider-history-isolation | rule:provider-history-isolation | Provider history and model-readable files are isolated per owner; a session cannot read another tenant's history or shared credentials. | ADR-0014 | Accepted | decided | run-bound |
| ADR-0014/worker-owned-isolated-sessions | rule:worker-owned-isolated-sessions | The worker bounds provider processes, and each persistent session is bound to one tenant, actor, job, and runtime profile; only the current lease claim may resume it. | ADR-0014 | Accepted | decided | run-bound |

## agent-worker — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0010/running-jobs-keep-their-lease | rule:running-jobs-keep-their-lease | A worker renews each running job's lease, stops the agent when the lease is lost, and brings every cancel it notices to a terminal state. | ADR-0010 | Accepted | decided | not-run-bound |

## interview-documents — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0009/immutable-document-revisions | rule:immutable-document-revisions | Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders. | ADR-0009 | Accepted | decided | run-bound |
| ADR-0009/interview-owns-documents | rule:interview-owns-documents | Candidate documents, templates, revisions, and exports are owned by the Interview product. | ADR-0009 | Accepted | decided | run-bound |
| ADR-0009/member-private-documents | rule:member-private-documents | Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person. | ADR-0009 | Accepted | decided | run-bound |
| ADR-0010/agent-profiles-write-documents | rule:agent-profiles-write-documents | Any gateway language profile that declares structured generation may write documents, including the agent profiles, and an agent call runs only as a bounded read-only job in the agent worker. | ADR-0010 | Accepted | decided | not-run-bound |
| ADR-0010/generation-limits-are-configured | rule:generation-limits-are-configured | The call cap, fields per call, tries, field length, worker concurrency and lease are deployment settings with defaults and bounds; a value out of bounds stops startup and names the setting. | ADR-0010 | Accepted | decided | not-run-bound |
| ADR-0010/generation-stops-with-its-reader | rule:generation-stops-with-its-reader | Generation progress reaches the page as a stream, a document is saved only when complete, and generation stops with its reader. | ADR-0010 | Accepted | decided | not-run-bound |
| ADR-0010/parallel-document-generation | rule:parallel-document-generation | A document is written in at most the configured number of structured calls, one call when the template fits within one call's field budget, each over contiguous model-filled fields in template order, through AiExecutionGateway against a template revision and an immutable candidate-profile revision. | ADR-0010 | Accepted | decided | not-run-bound |
| ADR-0015/complete-revision-publish | rule:complete-revision-publish | Only a complete, structurally validated field snapshot may be saved; progress remains provisional, and a stale revision or repeated generation identity cannot publish a second revision. | ADR-0015 | Proposed | decided | run-bound |
| ADR-0015/exact-owned-batches | rule:exact-owned-batches | Each model batch owns a disjoint, contiguous set of template fields and must return exactly those keys with string values before its result can enter progress or a document. | ADR-0015 | Proposed | decided | run-bound |
| ADR-0015/immutable-generation-identity | rule:immutable-generation-identity | A generation binds its owner, selected target, template and profile revisions, source selection, requested fields, and base document revision before model work begins. | ADR-0015 | Proposed | decided | run-bound |
| ADR-0015/measured-document-grouping | rule:measured-document-grouping | Grouping is selected from same-input, same-machine trials of one, three, and five model groups that record visible-field time, total time, calls, tokens, cost, and failures. | ADR-0015 | Proposed | decided | run-bound |
| ADR-0015/source-facts-own-authority | rule:source-facts-own-authority | Direct-source candidate, candidacy, and interview values remain authoritative; missing facts stay blank, while generated prose is a draft and never updates source preferences or profile facts. | ADR-0015 | Proposed | decided | run-bound |

## Exempt ADRs (0)

_None._

## Provenance

_Freshness is the deterministic input digests below; no wall-clock timestamp enters this file._

- `adr_frontmatter_sha256`: `491163e798d5ba17f3ff50fe68a151d553d9bb126ab1cc2bd3e753621b5a794c`
- `governs_from`: `None`
- `invariants_sha256`: `57179ec45e978a0ccce122a1a659de4748a13c0b5afdc3c9eaf2bf8d06696201`
- `observations_sha256`: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `reconciliations_sha256`: `None`
- `schema`: `4`
- `survey_receipts_sha256`: `None`
- `tool`: `compile-doctrine.py`
