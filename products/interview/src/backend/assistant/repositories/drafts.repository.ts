import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../workspace-contracts";

// Workspace drafts, what an applied proposal replaced, and saved answer
// revisions: persistence only.
// Each function runs one statement on the transaction the workspace service
// opened and bound, and returns its rows; what a missing or stale row means is the service's rule.
const where = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const values = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];

// Pins the transaction to this product, beside the tenant and actor.
export const bindProduct = (tx: WorkspaceTransaction, productId: string) =>
  tx.query("SELECT set_config('app.product_id',$1,true)", [productId]);

export const insertDraft = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: string,
  artifactId: string,
  value: unknown,
) =>
  tx.query(
    "INSERT INTO interview.assistant_drafts (tenant_id,actor_id,product_id,workspace_id,artifact_id,value) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *",
    [...values(scope), workspaceId, artifactId, JSON.stringify(value)],
  );

// One draft; `lock` holds its row for the transaction.
export const selectDraft = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: unknown,
  artifactId: unknown,
  lock: boolean,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5${lock ? " FOR UPDATE" : ""}`,
    [...values(scope), workspaceId, artifactId],
  );

// Compare-and-swap on the revision: no row back means it moved.
export const updateDraftValue = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  origin: { workspaceId: string; artifactId: string; artifactRevision: number },
  value: unknown,
  clearProvenance: boolean,
) =>
  tx.query(
    `UPDATE interview.assistant_drafts SET value=$7::jsonb,revision=revision+1,updated_at=now(),provenance=CASE WHEN $8::boolean THEN NULL WHEN provenance IS NOT NULL THEN jsonb_set(provenance,'{draftRevision}',to_jsonb(revision+1)) ELSE NULL END WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND revision=$6 RETURNING *`,
    [
      ...values(scope),
      origin.workspaceId,
      origin.artifactId,
      origin.artifactRevision,
      JSON.stringify(value),
      clearProvenance,
    ],
  );

export const upsertRevert = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  revert: {
    proposalId: string;
    workspaceId: string;
    artifactId: string;
    appliedRevision: number;
    previousValue: unknown;
    previousProvenance: unknown;
  },
) =>
  tx.query(
    `INSERT INTO interview.assistant_reverts (tenant_id,actor_id,product_id,proposal_id,workspace_id,artifact_id,applied_revision,previous_value,previous_provenance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       ON CONFLICT (tenant_id,actor_id,product_id,proposal_id) DO UPDATE SET applied_revision=EXCLUDED.applied_revision,previous_value=EXCLUDED.previous_value,previous_provenance=EXCLUDED.previous_provenance,reverted_revision=NULL`,
    [
      ...values(scope),
      revert.proposalId,
      revert.workspaceId,
      revert.artifactId,
      revert.appliedRevision,
      JSON.stringify(revert.previousValue),
      revert.previousProvenance
        ? JSON.stringify(revert.previousProvenance)
        : null,
    ],
  );

export const selectRevertForUpdate = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  proposalId: string,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_reverts WHERE ${where} AND proposal_id=$4 FOR UPDATE`,
    [...values(scope), proposalId],
  );

export const selectDraftRevisionForUpdate = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: unknown,
  artifactId: unknown,
) =>
  tx.query(
    `SELECT revision FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 FOR UPDATE`,
    [...values(scope), workspaceId, artifactId],
  );

export const restoreDraft = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: unknown,
  artifactId: unknown,
  previousValue: unknown,
  previousProvenance: unknown,
) =>
  tx.query(
    `UPDATE interview.assistant_drafts SET value=$6::jsonb,provenance=$7::jsonb,revision=revision+1,updated_at=now() WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 RETURNING *`,
    [
      ...values(scope),
      workspaceId,
      artifactId,
      JSON.stringify(previousValue),
      previousProvenance ? JSON.stringify(previousProvenance) : null,
    ],
  );

export const markReverted = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  proposalId: string,
  revertedRevision: number,
) =>
  tx.query(
    `UPDATE interview.assistant_reverts SET reverted_revision=$5 WHERE ${where} AND proposal_id=$4`,
    [...values(scope), proposalId, revertedRevision],
  );

export const selectRevertedRevision = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  proposalId: string,
) =>
  tx.query(
    `SELECT reverted_revision FROM interview.assistant_reverts WHERE ${where} AND proposal_id=$4`,
    [...values(scope), proposalId],
  );

export const incrementSavedRevision = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: string,
  artifactId: string,
) =>
  tx.query(
    `UPDATE interview.assistant_drafts SET saved_revision=saved_revision+1 WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 RETURNING saved_revision`,
    [...values(scope), workspaceId, artifactId],
  );

export const insertAnswerRevision = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  saved: {
    workspaceId: string;
    artifactId: string;
    savedRevision: unknown;
    draftRevision: number;
    value: unknown;
    provenance: unknown;
  },
) =>
  tx.query(
    "INSERT INTO interview.assistant_answer_revisions (tenant_id,actor_id,product_id,workspace_id,artifact_id,saved_revision,draft_revision,value,provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *",
    [
      ...values(scope),
      saved.workspaceId,
      saved.artifactId,
      saved.savedRevision,
      saved.draftRevision,
      JSON.stringify(saved.value),
      JSON.stringify(saved.provenance ?? null),
    ],
  );

export const selectAnswerRevision = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: string,
  artifactId: string,
  savedRevision: number,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_answer_revisions WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND saved_revision=$6`,
    [...values(scope), workspaceId, artifactId, savedRevision],
  );

export const listAnswerRevisionRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: string,
  artifactId: string,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_answer_revisions WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 ORDER BY saved_revision DESC LIMIT 100`,
    [...values(scope), workspaceId, artifactId],
  );

// Newest first, for the question lists.
export const listDraftRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: string,
) =>
  tx.query(
    `SELECT artifact_id,revision,updated_at,value FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 ORDER BY updated_at DESC, artifact_id LIMIT 50`,
    [...values(scope), workspaceId],
  );

export const updateDraftProvenance = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  origin: { workspaceId: string; artifactId: string; artifactRevision: number },
  provenance: unknown,
) =>
  tx.query(
    `UPDATE interview.assistant_drafts SET provenance=$7::jsonb WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND revision=$6 RETURNING revision`,
    [
      ...values(scope),
      origin.workspaceId,
      origin.artifactId,
      origin.artifactRevision,
      JSON.stringify(provenance),
    ],
  );
