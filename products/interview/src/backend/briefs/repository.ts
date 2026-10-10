import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../assistant/workspace";

// Spoken briefs (`interview.concept_briefs`): persistence only. Every function
// takes the tenant-bound transaction the caller opened and returns rows; what a
// missing row means is the caller's decision.
type Row = Record<string, unknown>;
const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];

export const listBriefRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) =>
  tx.query(
    `SELECT id,kind,topic,updated_at FROM interview.concept_briefs WHERE ${scoped} ORDER BY updated_at DESC LIMIT 100`,
    ids(scope),
  );

export async function findBriefRow(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
): Promise<Row | undefined> {
  const [row] = await tx.query(
    `SELECT * FROM interview.concept_briefs WHERE ${scoped} AND id=$4`,
    [...ids(scope), id],
  );
  return row;
}

// The three columns the assistant reads when a brief is its source.
export async function findBriefSourceRow(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
): Promise<Row | undefined> {
  const [row] = await tx.query(
    "SELECT kind,topic,value FROM interview.concept_briefs WHERE tenant_id=$1 AND actor_id=$2 AND product_id=$3 AND id=$4",
    [...ids(scope), id],
  );
  return row;
}

export async function insertBriefRow(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  brief: { id: string; kind: string; topic: string; value: unknown },
): Promise<Row> {
  const [row] = await tx.query(
    "INSERT INTO interview.concept_briefs(tenant_id,actor_id,product_id,id,kind,topic,value) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",
    [
      ...ids(scope),
      brief.id,
      brief.kind,
      brief.topic,
      JSON.stringify(brief.value),
    ],
  );
  return row!;
}

export const deleteBriefRow = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
) =>
  tx.query(
    `DELETE FROM interview.concept_briefs WHERE ${scoped} AND id=$4 RETURNING id`,
    [...ids(scope), id],
  );
