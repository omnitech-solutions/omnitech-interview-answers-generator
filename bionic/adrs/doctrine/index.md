# doctrine — current beliefs, per governs domain

_The per-domain view of what the project currently holds to be true, compiled deterministically from the summaries projection and reconciled against the ratified invariants. Doctrine is the primary read surface for a current-belief question; it holds zero authority, and the ADR body is the record on any disagreement. Regenerated; edits are overwritten._

_State legend: **believed** (every applicable invariant reconciles) · **backfilled** (admitted via the historic backfill, no applicable invariant) · **no-applicable-invariant** (a prospective rule no ratified invariant references) · **BROKEN** (an un-adjudicated, digest-stale, or collision pairing — the belief is withheld until a human reconciles)._

_Basis legend — the mechanical fact measured behind each rule: **run-bound** (a run snapshot's artifacts reference this rule's source ADR) · **not-run-bound** (no run snapshot does) · **evidence-resolves** (the observation record names at least one evidence path and every one resolves on disk) · **evidence-missing** (a named evidence path does not resolve, or the record names none). No basis value is evidence that the rule holds: each says which fact was measured, and none of them measures the rule._

## interview-documents — no-applicable-invariant

| handle | citation | rule | source ADR | source_status | disposition | basis |
|--------|----------|------|------------|---------------|-------------|-------|
| ADR-0009/immutable-document-revisions | rule:immutable-document-revisions | Every document edit, regeneration, and restore creates an immutable revision, and each export identifies the revision it renders. | ADR-0009 | Accepted | decided | run-bound |
| ADR-0009/interview-owns-documents | rule:interview-owns-documents | Candidate documents, templates, revisions, and exports are owned by the Interview product. | ADR-0009 | Accepted | decided | run-bound |
| ADR-0009/member-private-documents | rule:member-private-documents | Private document rows and artifacts require matching tenant and actor, and a linked candidacy must identify that actor's person. | ADR-0009 | Accepted | decided | run-bound |
| ADR-0009/structured-document-generation | rule:structured-document-generation | Document generation uses one structured AiExecutionGateway call against a template revision and an immutable candidate-profile revision. | ADR-0009 | Accepted | decided | run-bound |

## Exempt ADRs (0)

_None._

## Provenance

_Freshness is the deterministic input digests below; no wall-clock timestamp enters this file._

- `adr_frontmatter_sha256`: `3b9158407ccf1c4ea63c7134af56aeb89712eb99694937b87db4cf7876f290c0`
- `governs_from`: `None`
- `invariants_sha256`: `57179ec45e978a0ccce122a1a659de4748a13c0b5afdc3c9eaf2bf8d06696201`
- `observations_sha256`: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `reconciliations_sha256`: `None`
- `schema`: `4`
- `survey_receipts_sha256`: `None`
- `tool`: `compile-doctrine.py`
