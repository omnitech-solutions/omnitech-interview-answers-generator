import { createHash, randomUUID } from "node:crypto";
import {
  type BriefingDraft,
  type BriefingProfileImport,
  briefingDraftSchema,
  type CandidateMatrix,
  candidateMatrixSchema,
} from "@omnitech/interview-contracts";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  WorkspaceError,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "../assistant/workspace";

const scoped = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const ids = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const date = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);
export type ProfileVersion = Readonly<{
  id: string;
  name: string;
  revision: number;
  sha256: string;
  matrix: CandidateMatrix;
}>;
export type ProposalRecord = Readonly<{
  id: string;
  artifactId: string;
  baseRevision: number;
  profileId: string;
  profileRevision: number;
  profileSha256: string;
  briefing: BriefingDraft;
  sourceSnapshot: unknown;
}>;

export class BriefingRepository {
  private readonly workspace: InterviewWorkspaceRepository;
  constructor(database: WorkspaceDatabasePort) {
    this.workspace = new InterviewWorkspaceRepository(database);
  }

  async importProfile(
    scope: WorkspaceScope,
    input: BriefingProfileImport,
  ): Promise<Omit<ProfileVersion, "matrix">> {
    const matrix = candidateMatrixSchema.parse(input.matrix);
    if (Buffer.byteLength(JSON.stringify(matrix), "utf8") > 1_048_576)
      throw new WorkspaceError("matrix-too-large");
    const id = input.profileId ?? randomUUID();
    return this.workspace.transaction(scope, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([...ids(scope), "profiles"]),
      ]);
      const [existing] = await tx.query(
        `SELECT revision,revoked_at FROM interview.candidate_profiles WHERE ${scoped} AND id=$4 FOR UPDATE`,
        [...ids(scope), id],
      );
      if (existing) {
        if (existing["revoked_at"]) throw new WorkspaceError("not-found");
        if (input.expectedRevision !== Number(existing["revision"]))
          throw new WorkspaceError("revision-conflict");
        await tx.query(
          `UPDATE interview.candidate_profiles SET revision=revision+1,name=$5,updated_at=now() WHERE ${scoped} AND id=$4`,
          [...ids(scope), id, input.name],
        );
      } else {
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== 0
        )
          throw new WorkspaceError("revision-conflict");
        await tx.query(
          "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,$3,$4,$5,1)",
          [...ids(scope), id, input.name],
        );
      }
      const revision = existing ? Number(existing["revision"]) + 1 : 1;
      const sha256 = hash(matrix);
      await tx.query(
        "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [
          ...ids(scope),
          id,
          revision,
          input.name,
          sha256,
          JSON.stringify(matrix),
        ],
      );
      return { id, name: input.name, revision, sha256 };
    });
  }

  // The local default profile follows its source file: none yet, or file
  // content that was never a revision, saves one.
  async syncDefaultProfile(
    scope: WorkspaceScope,
    input: { name: string; matrix: unknown },
  ): Promise<void> {
    const matrix = candidateMatrixSchema.parse(input.matrix);
    if (Buffer.byteLength(JSON.stringify(matrix), "utf8") > 1_048_576)
      throw new WorkspaceError("matrix-too-large");
    const id = "local-experience-matrix";
    const sha256 = hash(matrix);
    await this.workspace.transaction(scope, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        JSON.stringify([...ids(scope), "profiles"]),
      ]);
      const [existing] = await tx.query(
        `SELECT revision,revoked_at FROM interview.candidate_profiles WHERE ${scoped} AND id=$4 FOR UPDATE`,
        [...ids(scope), id],
      );
      if (existing?.["revoked_at"]) return;
      if (!existing) {
        const any = await tx.query(
          `SELECT id FROM interview.candidate_profiles WHERE ${scoped} LIMIT 1`,
          ids(scope),
        );
        if (any.length) return;
        await tx.query(
          "INSERT INTO interview.candidate_profiles(tenant_id,actor_id,product_id,id,name,revision) VALUES($1,$2,$3,$4,$5,1)",
          [...ids(scope), id, input.name],
        );
      } else {
        // Once per file content: later edits made in the app stay latest.
        const [known] = await tx.query(
          `SELECT 1 AS found FROM interview.candidate_profile_revisions WHERE ${scoped} AND id=$4 AND sha256=$5 LIMIT 1`,
          [...ids(scope), id, sha256],
        );
        if (known) return;
        await tx.query(
          `UPDATE interview.candidate_profiles SET revision=revision+1,updated_at=now() WHERE ${scoped} AND id=$4`,
          [...ids(scope), id],
        );
      }
      const revision = existing ? Number(existing["revision"]) + 1 : 1;
      await tx.query(
        "INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [
          ...ids(scope),
          id,
          revision,
          input.name,
          sha256,
          JSON.stringify(matrix),
        ],
      );
    });
  }

  async listProfiles(scope: WorkspaceScope) {
    return this.workspace.transaction(scope, async (tx) => {
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
    });
  }
  async getProfileRevision(
    scope: WorkspaceScope,
    id: string,
    revision: number,
  ): Promise<ProfileVersion> {
    return this.workspace.transaction(scope, (tx) =>
      this.getProfileRevisionTransaction(tx, scope, id, revision),
    );
  }
  async getProfileRevisionTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    id: string,
    revision: number,
    lock = false,
  ): Promise<ProfileVersion> {
    const [row] = await tx.query(
      `SELECT r.id,r.name,r.revision,r.sha256,r.matrix FROM interview.candidate_profile_revisions r JOIN interview.candidate_profiles p ON (p.tenant_id,p.actor_id,p.product_id,p.id)=(r.tenant_id,r.actor_id,r.product_id,r.id) WHERE r.${scoped.replaceAll(" AND ", " AND r.")} AND r.id=$4 AND r.revision=$5 AND p.revoked_at IS NULL${lock ? " FOR SHARE OF p" : ""}`,
      [...ids(scope), id, revision],
    );
    if (!row) throw new WorkspaceError("not-found");
    const matrix = candidateMatrixSchema.parse(row["matrix"]);
    if (hash(matrix) !== row["sha256"])
      throw new WorkspaceError("evidence-hash-conflict");
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      revision: Number(row["revision"]),
      sha256: String(row["sha256"]),
      matrix,
    };
  }
  async requireCurrentProfile(
    scope: WorkspaceScope,
    id: string,
    revision: number,
  ): Promise<ProfileVersion> {
    const profile = await this.getProfileRevision(scope, id, revision);
    const [latest] = await this.listProfiles(scope).then((profiles) =>
      profiles.filter((item) => item.id === id),
    );
    if (!latest || latest.revision !== revision)
      throw new WorkspaceError("evidence-revision-conflict");
    return profile;
  }
  async createProposal(
    scope: WorkspaceScope,
    input: Omit<ProposalRecord, "id">,
  ): Promise<ProposalRecord> {
    const id = randomUUID();
    const briefing = briefingDraftSchema.parse(input.briefing);
    await this.workspace.transaction(scope, async (tx) => {
      await tx.query(
        "INSERT INTO interview.briefing_proposals(tenant_id,actor_id,product_id,id,artifact_id,base_revision,profile_id,profile_revision,profile_sha256,value,source_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)",
        [
          ...ids(scope),
          id,
          input.artifactId,
          input.baseRevision,
          input.profileId,
          input.profileRevision,
          input.profileSha256,
          JSON.stringify(briefing),
          JSON.stringify(input.sourceSnapshot),
        ],
      );
    });
    return { ...input, briefing, id };
  }
  async getProposal(
    scope: WorkspaceScope,
    id: string,
  ): Promise<ProposalRecord> {
    return this.workspace.transaction(scope, (tx) =>
      this.getProposalTransaction(tx, scope, id),
    );
  }
  async getProposalTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    id: string,
  ): Promise<ProposalRecord> {
    const [row] = await tx.query(
      `SELECT * FROM interview.briefing_proposals WHERE ${scoped} AND id=$4`,
      [...ids(scope), id],
    );
    if (!row) throw new WorkspaceError("not-found");
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
  async listArtifacts(scope: WorkspaceScope) {
    return this.workspace.transaction(scope, async (tx) => {
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
    });
  }
}
