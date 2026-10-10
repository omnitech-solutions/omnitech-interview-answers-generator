import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../workspace-contracts";

// Idempotent effect receipts (`interview.assistant_effect_receipts`):
// persistence only.
// Each function runs one statement on the transaction the workspace service
// opened and bound, and returns its rows; what a missing or stale row means is the service's rule.
const where = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const values = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];

// The latest completed run per question, from its receipts.
export const latestCompletedRunRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  workspaceId: string,
) =>
  tx.query(
    `SELECT DISTINCT ON (payload->'origin'->>'artifactId') payload->'origin'->>'artifactId' AS artifact_id, result->'execution' AS execution, updated_at FROM interview.assistant_effect_receipts WHERE ${where} AND operation='run-code' AND state='completed' AND payload->'origin'->>'workspaceId'=$4 ORDER BY payload->'origin'->>'artifactId', updated_at DESC`,
    [...values(scope), workspaceId],
  );

export const insertEffectReceipt = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  receipt: {
    operation: string;
    requestId: string;
    id: string;
    fingerprint: string;
    payload: string;
  },
) =>
  tx.query(
    "INSERT INTO interview.assistant_effect_receipts(tenant_id,actor_id,product_id,operation,request_id,id,fingerprint,payload,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'started')",
    [
      ...values(scope),
      receipt.operation,
      receipt.requestId,
      receipt.id,
      receipt.fingerprint,
      receipt.payload,
    ],
  );

// Serialises one idempotent request for the transaction.
export const lockEffect = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  operation: string,
  requestId: string,
) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify([...values(scope), operation, requestId]),
  ]);

export const selectEffectReceiptForUpdate = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  operation: string,
  requestId: string,
) =>
  tx.query(
    `SELECT * FROM interview.assistant_effect_receipts WHERE ${where} AND operation=$4 AND request_id=$5 FOR UPDATE`,
    [...values(scope), operation, requestId],
  );

// Only a started receipt completes: no row back means it was not.
export const completeEffectReceipt = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  operation: string,
  requestId: string,
  result: unknown,
) =>
  tx.query(
    `UPDATE interview.assistant_effect_receipts SET state='completed',result=$6::jsonb,updated_at=now() WHERE ${where} AND operation=$4 AND request_id=$5 AND state='started' RETURNING id`,
    [...values(scope), operation, requestId, JSON.stringify(result)],
  );

export const interruptRunCodeReceipt = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  requestId: string,
) =>
  tx.query(
    `UPDATE interview.assistant_effect_receipts SET state='interrupted',updated_at=now() WHERE ${where} AND operation='run-code' AND request_id=$4 AND state='started'`,
    [...values(scope), requestId],
  );
