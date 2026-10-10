import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../assistant/workspace";

// Finished rehearsals (`interview.rehearsal_sessions`) and the Active Session
// rows a rehearsal run counts hints from: persistence only.
type Row = Record<string, unknown>;
const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];

// Serialises saves of one rehearsal run for one member, for the transaction.
export const lockRehearsalRun = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  rehearsalRunId: string,
) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `rehearsal-run:${scope.tenantId}:${scope.actorId}:${rehearsalRunId}`,
  ]);

export async function rehearsalRunSaved(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  rehearsalRunId: string,
): Promise<boolean> {
  const [saved] = await tx.query(
    `SELECT 1 AS saved FROM interview.rehearsal_sessions WHERE ${scoped} AND value->>'rehearsalRunId' = $4 LIMIT 1`,
    [...ids(scope), rehearsalRunId],
  );
  return Boolean(saved);
}

// Tombstones included: a purge keeps the count. Tenant and owner are uuids.
export const activeSessionsOfRun = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  rehearsalRunId: string,
) =>
  tx.query(
    `SELECT strict, shown_draft_count FROM interview.active_sessions
     WHERE tenant_id = $1::uuid AND owner_user_id = $2::uuid AND rehearsal_run_id = $3`,
    [scope.tenantId, scope.actorId, rehearsalRunId],
  );

export async function latestRehearsalScoreRow(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
): Promise<Row | undefined> {
  const [row] = await tx.query(
    `SELECT score FROM interview.rehearsal_sessions WHERE ${scoped} ORDER BY ended_at DESC LIMIT 1`,
    ids(scope),
  );
  return row;
}

export const listRehearsalRows = (
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) =>
  tx.query(
    `SELECT * FROM interview.rehearsal_sessions WHERE ${scoped} ORDER BY ended_at DESC LIMIT 20`,
    ids(scope),
  );

export async function insertRehearsalRow(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  rehearsal: {
    id: string;
    format: string;
    score: number;
    value: unknown;
    endedAt: unknown;
  },
): Promise<Row> {
  const [row] = await tx.query(
    "INSERT INTO interview.rehearsal_sessions(tenant_id,actor_id,product_id,id,format,score,value,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *",
    [
      ...ids(scope),
      rehearsal.id,
      rehearsal.format,
      rehearsal.score,
      JSON.stringify(rehearsal.value),
      rehearsal.endedAt,
    ],
  );
  return row!;
}
