import { briefingDraftSchema } from "@omnitech/interview-contracts";
import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../../assistant/workspace";
import type { ProposalRecord } from "../contracts";

const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];
const date = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

export async function insertProposal(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  proposal: ProposalRecord,
) {
  await tx.query(
    "INSERT INTO interview.briefing_proposals(tenant_id,actor_id,product_id,id,artifact_id,base_revision,profile_id,profile_revision,profile_sha256,value,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)",
    [
      ...ids(scope),
      proposal.id,
      proposal.artifactId,
      proposal.baseRevision,
      proposal.profileId,
      proposal.profileRevision,
      proposal.profileSha256,
      JSON.stringify(proposal.briefing),
      JSON.stringify(proposal.sourceSnapshot),
    ],
  );
}

export async function findProposal(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
): Promise<ProposalRecord | undefined> {
  const [row] = await tx.query(
    `SELECT * FROM interview.briefing_proposals WHERE ${scoped} AND id=$4`,
    [...ids(scope), id],
  );
  if (!row) return undefined;
  return {
    id: String(row["id"]),
    artifactId: String(row["artifact_id"]),
    baseRevision: Number(row["base_revision"]),
    profileId: String(row["profile_id"]),
    profileRevision: Number(row["profile_revision"]),
    profileSha256: String(row["profile_sha256"]),
    briefing: briefingDraftSchema.parse(row["value"]),
    sourceSnapshot: row["source_snapshot"],
  };
}

export async function listArtifacts(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) {
  const rows = await tx.query(
    `SELECT d.artifact_id,d.revision,d.saved_revision,d.updated_at,d.value FROM interview.assistant_drafts d WHERE d.tenant_id=$1 AND d.actor_id=$2 AND d.product_id=$3 AND d.workspace_id='briefings' AND EXISTS (SELECT 1 FROM interview.candidate_profiles p WHERE (p.tenant_id,p.actor_id,p.product_id)=(d.tenant_id,d.actor_id,d.product_id) AND p.id=d.value->'briefing'->'context'->'profile'->>'id' AND p.revoked_at IS NULL) ORDER BY d.updated_at DESC LIMIT 100`,
    ids(scope),
  );
  return rows.map((row) => ({
    id: String(row["artifact_id"]),
    title: briefingDraftSchema.parse(
      (row["value"] as Record<string, unknown>)["briefing"],
    ).title,
    revision: Number(row["revision"]),
    savedRevision: Number(row["saved_revision"]),
    updatedAt: date(row["updated_at"]),
  }));
}
