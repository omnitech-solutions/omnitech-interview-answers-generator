import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../workspace-contracts";

// Evidence sources (`interview.assistant_evidence`): persistence only.
// Each function runs one statement on the transaction the workspace service
// opened and bound, and returns its rows; what a missing or stale row means is the service's rule.
const where = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const values = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];

export const insertEvidence = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  evidence: {
    id: string;
    revision: number;
    sha256: string;
    locator: unknown;
    text: string;
    sourceKind: string;
    classification: string;
    audience: readonly string[];
    metrics?: unknown;
  },
) =>
  tx.query(
    "INSERT INTO interview.assistant_evidence (tenant_id,actor_id,product_id,id,revision,sha256,locator,text,source_kind,classification,audience,metrics) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)",
    [
      ...values(scope),
      evidence.id,
      evidence.revision,
      evidence.sha256,
      evidence.locator,
      evidence.text,
      evidence.sourceKind,
      evidence.classification,
      evidence.audience,
      JSON.stringify(evidence.metrics ?? []),
    ],
  );

// Serialises work on one evidence source for the transaction.
export const lockEvidence = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  evidenceId: string,
) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify([...values(scope), "evidence", evidenceId]),
  ]);

export const selectEvidenceRevision = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  evidenceId: string,
  revision: number,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_evidence WHERE ${where} AND id=$4 AND revision=$5`,
    [...values(scope), evidenceId, revision],
  );

export const selectNewerEvidence = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  evidenceId: string,
  revision: number,
) =>
  tx.query(
    `SELECT revision FROM interview.assistant_evidence WHERE ${where} AND id=$4 AND revision>$5 LIMIT 1`,
    [...values(scope), evidenceId, revision],
  );

export const selectLatestEvidence = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  evidenceId: string,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_evidence WHERE ${where} AND id=$4 ORDER BY revision DESC LIMIT 1`,
    [...values(scope), evidenceId],
  );

// The actor's current evidence (latest revision of each), optionally matching a query.
export const currentEvidenceRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  query: string | null,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_evidence e WHERE ${where} AND $2=ANY(audience) AND ($4::text IS NULL OR to_tsvector('english',text) @@ plainto_tsquery('english',$4)) AND NOT EXISTS (SELECT 1 FROM interview.assistant_evidence newer WHERE (newer.tenant_id,newer.actor_id,newer.product_id,newer.id)=(e.tenant_id,e.actor_id,e.product_id,e.id) AND newer.revision>e.revision) ORDER BY id LIMIT 64`,
    [...values(scope), query],
  );

export const searchEvidenceRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  query: string,
  limit: number,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_evidence e WHERE ${where} AND $2=ANY(audience) AND to_tsvector('english',text) @@ plainto_tsquery('english',$4) AND NOT EXISTS (SELECT 1 FROM interview.assistant_evidence newer WHERE (newer.tenant_id,newer.actor_id,newer.product_id,newer.id)=(e.tenant_id,e.actor_id,e.product_id,e.id) AND newer.revision>e.revision) ORDER BY id LIMIT $5`,
    [...values(scope), query, limit],
  );

// The latest revision of every evidence source in this private workspace, as
// its classification and audience. Persistence only: whether the workspace is
// readable is the caller's rule.
export const latestEvidenceAccessRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) =>
  tx.query(
    "SELECT classification,audience FROM (SELECT DISTINCT ON(id) id,classification,audience FROM interview.assistant_evidence WHERE tenant_id=$1 AND actor_id=$2 AND product_id=$3 ORDER BY id,revision DESC) latest",
    [scope.tenantId, scope.actorId, scope.productId],
  );
