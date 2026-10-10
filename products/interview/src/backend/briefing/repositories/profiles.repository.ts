import { candidateMatrixSchema } from "@omnitech/interview-contracts";
import type {
  WorkspaceScope,
  WorkspaceTransaction,
} from "../../assistant/workspace";
import type { ExistingProfile, ProfileVersion } from "../contracts";

const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];
const date = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

export async function lockProfiles(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify([...ids(scope), "profiles"]),
  ]);
}

export async function findProfileForUpdate(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
): Promise<ExistingProfile | undefined> {
  const [existing] = await tx.query(
    `SELECT revision,revoked_at FROM interview.candidate_profiles WHERE ${scoped} AND id=$4 FOR UPDATE`,
    [...ids(scope), id],
  );
  return existing
    ? {
        revision: Number(existing["revision"]),
        revoked: Boolean(existing["revoked_at"]),
      }
    : undefined;
}

export async function updateProfile(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
  name: string,
) {
  await tx.query(
    `UPDATE interview.candidate_profiles SET revision=revision+1,name=$5,updated_at=now() WHERE ${scoped} AND id=$4`,
    [...ids(scope), id, name],
  );
}

export async function insertProfile(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
  name: string,
) {
  await tx.query(
    "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,$3,$4,$5,1)",
    [...ids(scope), id, name],
  );
}

export async function insertProfileRevision(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  profile: ProfileVersion,
) {
  await tx.query(
    "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      ...ids(scope),
      profile.id,
      profile.revision,
      profile.name,
      profile.sha256,
      JSON.stringify(profile.matrix),
    ],
  );
}

export async function findAnyProfile(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) {
  return tx.query(
    `SELECT id FROM interview.candidate_profiles WHERE ${scoped} LIMIT 1`,
    ids(scope),
  );
}

export async function findKnownContent(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
  sha256: string,
) {
  const [known] = await tx.query(
    `SELECT 1 AS found FROM interview.candidate_profile_revisions WHERE ${scoped} AND id=$4 AND sha256=$5 LIMIT 1`,
    [...ids(scope), id, sha256],
  );
  return known;
}

export async function advanceProfileRevision(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
) {
  await tx.query(
    `UPDATE interview.candidate_profiles SET revision=revision+1,updated_at=now() WHERE ${scoped} AND id=$4`,
    [...ids(scope), id],
  );
}

export async function listProfiles(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
) {
  const rows = await tx.query(
    `SELECT id,name,revision,updated_at FROM interview.candidate_profiles WHERE ${scoped} AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 100`,
    ids(scope),
  );
  return rows.map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    revision: Number(row["revision"]),
    updatedAt: date(row["updated_at"]),
  }));
}

export async function findProfileRevision(
  tx: WorkspaceTransaction,
  scope: WorkspaceScope,
  id: string,
  revision: number,
  lock = false,
): Promise<ProfileVersion | undefined> {
  const [row] = await tx.query(
    `SELECT r.id,r.name,r.revision,r.sha256,r.matrix FROM interview.candidate_profile_revisions r JOIN interview.candidate_profiles p ON (p.tenant_id,p.actor_id,p.product_id,p.id)=(r.tenant_id,r.actor_id,r.product_id,r.id) WHERE r.${scoped.replaceAll(" AND ", " AND r.")} AND r.id=$4 AND r.revision=$5 AND p.revoked_at IS NULL${lock ? " FOR SHARE OF p" : ""}`,
    [...ids(scope), id, revision],
  );
  return row
    ? {
        id: String(row["id"]),
        name: String(row["name"]),
        revision: Number(row["revision"]),
        sha256: String(row["sha256"]),
        matrix: candidateMatrixSchema.parse(row["matrix"]),
      }
    : undefined;
}
