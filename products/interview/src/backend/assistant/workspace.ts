import { createHash } from "node:crypto";
import { generatedAnswerSchema } from "@omnitech/interview-contracts";
import { z } from "zod";

// Structural host ports: compatible with the portable package's built exports,
// with no dependency on another checkout's TypeScript source or global store.
export interface WorkspaceTransaction {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
}
export interface WorkspaceDatabasePort {
  tenantTransaction<T>(
    tenantId: string,
    fn: (tx: WorkspaceTransaction) => Promise<T>,
  ): Promise<T>;
}
const id = z.string().max(256).trim().min(1);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const scopeSchema = z.strictObject({
  tenantId: id,
  actorId: id,
  productId: id,
});
const originSchema = z.strictObject({
  workspaceId: id,
  artifactId: id,
  artifactRevision: revision,
});
const boundedAnswerSchema = generatedAnswerSchema
  .extend({
    title: z.string().max(256).trim().min(1),
    answerMarkdown: z.string().max(100_000).trim().min(1),
    code: z.string().max(100_000),
    usageCode: z.string().max(100_000).default(""),
    testCode: z.string().max(100_000).default(""),
  })
  .strict();
export const interviewDraftSchema = z.strictObject({
  question: z.string().max(32_000).trim().min(1),
  notes: z.string().max(100_000).default(""),
  answer: boundedAnswerSchema.nullable().default(null),
});
// A patch must not inherit creation defaults: omitting notes/answer preserves
// the existing fields rather than resetting them during a proposal edit.
export const interviewDraftPatchSchema = z.strictObject({
  question: z.string().max(32_000).trim().min(1).optional(),
  notes: z.string().max(100_000).optional(),
  answer: boundedAnswerSchema.nullable().optional(),
});
const evidenceSchema = z.strictObject({
  id,
  revision,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().min(1).max(2048),
  text: z.string().max(100_000),
  sourceKind: z.enum(["candidate", "technical-reference"]),
  classification: z.enum(["public", "internal", "confidential", "restricted"]),
  audience: z.array(id).min(1).max(64),
});
export type WorkspaceScope = Readonly<z.infer<typeof scopeSchema>>;
export type WorkspaceOrigin = Readonly<z.infer<typeof originSchema>>;
export type InterviewDraft = Readonly<z.infer<typeof interviewDraftSchema>>;
export type InterviewDraftPatch = Readonly<
  z.infer<typeof interviewDraftPatchSchema>
>;
export type InterviewEvidence = Readonly<
  Omit<z.infer<typeof evidenceSchema>, "audience"> & {
    audience: readonly string[];
  }
>;
export type WorkspaceDraftRecord = Readonly<{
  origin: WorkspaceOrigin;
  value: InterviewDraft;
  updatedAt: string;
}>;
export type AnswerRevisionRecord = Readonly<{
  workspaceId: string;
  artifactId: string;
  savedRevision: number;
  draftRevision: number;
  value: InterviewDraft;
  createdAt: string;
}>;
export class WorkspaceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const where = "tenant_id=$1 AND actor_id=$2 AND product_id=$3";
const values = (scope: WorkspaceScope) => [
  scope.tenantId,
  scope.actorId,
  scope.productId,
];
const timestamp = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);
const draft = (row: Record<string, unknown>): WorkspaceDraftRecord => ({
  origin: originSchema.parse({
    workspaceId: row["workspace_id"],
    artifactId: row["artifact_id"],
    artifactRevision: Number(row["revision"]),
  }),
  value: interviewDraftSchema.parse(row["value"]),
  updatedAt: timestamp(row["updated_at"]),
});
const source = (row: Record<string, unknown>): InterviewEvidence =>
  evidenceSchema.parse({
    id: row["id"],
    revision: Number(row["revision"]),
    sha256: row["sha256"],
    locator: row["locator"],
    text: row["text"],
    sourceKind: row["source_kind"],
    classification: row["classification"],
    audience: row["audience"],
  });

export class InterviewWorkspaceRepository {
  constructor(private readonly database: WorkspaceDatabasePort) {}
  private async bind(tx: WorkspaceTransaction, scope: WorkspaceScope) {
    await tx.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.product_id',$2,true)",
      [scope.actorId, scope.productId],
    );
  }
  private transaction<T>(
    scope: WorkspaceScope,
    fn: (tx: WorkspaceTransaction, scope: WorkspaceScope) => Promise<T>,
  ): Promise<T> {
    scope = scopeSchema.parse(scope);
    return this.database.tenantTransaction(scope.tenantId, async (tx) => {
      await this.bind(tx, scope);
      return fn(tx, scope);
    });
  }
  async create(
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    initial: {
      question: string;
      notes?: string;
      answer?: InterviewDraft["answer"];
    },
  ): Promise<WorkspaceDraftRecord> {
    origin = originSchema.parse(origin);
    if (origin.artifactRevision !== 0)
      throw new WorkspaceError("revision-conflict");
    const value = interviewDraftSchema.parse(initial);
    return this.transaction(scope, async (tx, scope) => {
      const [row] = await tx.query(
        "INSERT INTO interview.assistant_drafts (tenant_id,actor_id,product_id,workspace_id,artifact_id,value) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *",
        [
          ...values(scope),
          origin.workspaceId,
          origin.artifactId,
          JSON.stringify(value),
        ],
      );
      return draft(row!);
    });
  }
  async read(
    scope: WorkspaceScope,
    workspaceId: string,
    artifactId: string,
  ): Promise<WorkspaceDraftRecord> {
    workspaceId = id.parse(workspaceId);
    artifactId = id.parse(artifactId);
    return this.transaction(scope, async (tx, scope) => {
      const [row] = await tx.query(
        `SELECT * FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5`,
        [...values(scope), workspaceId, artifactId],
      );
      if (!row) throw new WorkspaceError("not-found");
      return draft(row);
    });
  }
  async edit(
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    patch: InterviewDraftPatch,
  ): Promise<WorkspaceDraftRecord> {
    return this.transaction(scope, (tx, scope) =>
      this.editTransaction(tx, scope, origin, patch),
    );
  }
  // Same caller transaction as assistant proposal receipt insertion. No nested
  // transaction and no separate commit, so either both effects land or neither.
  async editTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    patch: InterviewDraftPatch,
  ): Promise<WorkspaceDraftRecord> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    origin = originSchema.parse(origin);
    const validated = interviewDraftPatchSchema.parse(patch);
    const [row] = await tx.query(
      `SELECT * FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 FOR UPDATE`,
      [...values(scope), origin.workspaceId, origin.artifactId],
    );
    if (!row) throw new WorkspaceError("not-found");
    if (Number(row["revision"]) !== origin.artifactRevision)
      throw new WorkspaceError("revision-conflict");
    const value = interviewDraftSchema.parse({
      ...interviewDraftSchema.parse(row["value"]),
      ...validated,
    });
    const [updated] = await tx.query(
      `UPDATE interview.assistant_drafts SET value=$7::jsonb,revision=revision+1,updated_at=now() WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND revision=$6 RETURNING *`,
      [
        ...values(scope),
        origin.workspaceId,
        origin.artifactId,
        origin.artifactRevision,
        JSON.stringify(value),
      ],
    );
    if (!updated) throw new WorkspaceError("revision-conflict");
    return draft(updated);
  }
  async save(
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
  ): Promise<AnswerRevisionRecord> {
    origin = originSchema.parse(origin);
    return this.transaction(scope, async (tx, scope) => {
      const [row] = await tx.query(
        `SELECT * FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 FOR UPDATE`,
        [...values(scope), origin.workspaceId, origin.artifactId],
      );
      if (!row) throw new WorkspaceError("not-found");
      if (Number(row["revision"]) !== origin.artifactRevision)
        throw new WorkspaceError("revision-conflict");
      const value = interviewDraftSchema.parse(row["value"]);
      if (!value.answer) throw new WorkspaceError("answer-required");
      const [counter] = await tx.query(
        `UPDATE interview.assistant_drafts SET saved_revision=saved_revision+1 WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 RETURNING saved_revision`,
        [...values(scope), origin.workspaceId, origin.artifactId],
      );
      const [saved] = await tx.query(
        "INSERT INTO interview.assistant_answer_revisions (tenant_id,actor_id,product_id,workspace_id,artifact_id,saved_revision,draft_revision,value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *",
        [
          ...values(scope),
          origin.workspaceId,
          origin.artifactId,
          counter!["saved_revision"],
          origin.artifactRevision,
          JSON.stringify(value),
        ],
      );
      return this.answerRevision(saved!);
    });
  }
  private answerRevision(row: Record<string, unknown>): AnswerRevisionRecord {
    return {
      workspaceId: String(row["workspace_id"]),
      artifactId: String(row["artifact_id"]),
      savedRevision: Number(row["saved_revision"]),
      draftRevision: Number(row["draft_revision"]),
      value: interviewDraftSchema.parse(row["value"]),
      createdAt: timestamp(row["created_at"]),
    };
  }
  async readAnswerRevision(
    scope: WorkspaceScope,
    workspaceId: string,
    artifactId: string,
    savedRevision: number,
  ): Promise<AnswerRevisionRecord> {
    workspaceId = id.parse(workspaceId);
    artifactId = id.parse(artifactId);
    revision.parse(savedRevision);
    return this.transaction(scope, async (tx, scope) => {
      const [row] = await tx.query(
        `SELECT * FROM interview.assistant_answer_revisions WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND saved_revision=$6`,
        [...values(scope), workspaceId, artifactId, savedRevision],
      );
      if (!row) throw new WorkspaceError("not-found");
      return this.answerRevision(row);
    });
  }
  async putEvidence(
    scope: WorkspaceScope,
    evidence: InterviewEvidence,
  ): Promise<void> {
    const validated = evidenceSchema.parse(evidence);
    if (
      createHash("sha256").update(validated.text).digest("hex") !==
      validated.sha256
    )
      throw new WorkspaceError("evidence-hash-conflict");
    await this.transaction(scope, async (tx, scope) => {
      await tx.query(
        "INSERT INTO interview.assistant_evidence (tenant_id,actor_id,product_id,id,revision,sha256,locator,text,source_kind,classification,audience) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          ...values(scope),
          validated.id,
          validated.revision,
          validated.sha256,
          validated.locator,
          validated.text,
          validated.sourceKind,
          validated.classification,
          validated.audience,
        ],
      );
    });
  }
  async readEvidence(
    scope: WorkspaceScope,
    evidenceId: string,
    evidenceRevision: number,
  ): Promise<InterviewEvidence> {
    evidenceId = id.parse(evidenceId);
    revision.parse(evidenceRevision);
    return this.transaction(scope, async (tx, scope) => {
      const [row] = await tx.query(
        `SELECT * FROM interview.assistant_evidence WHERE ${where} AND id=$4 AND revision=$5`,
        [...values(scope), evidenceId, evidenceRevision],
      );
      if (!row) throw new WorkspaceError("not-found");
      const evidence = source(row);
      if (!evidence.audience.includes(scope.actorId))
        throw new WorkspaceError("evidence-forbidden");
      return evidence;
    });
  }
  async searchEvidence(
    scope: WorkspaceScope,
    query: string,
    limit: number,
  ): Promise<readonly InterviewEvidence[]> {
    z.string().max(2048).trim().min(1).parse(query);
    z.number().int().min(1).max(100).parse(limit);
    return this.transaction(scope, async (tx, scope) => {
      const rows = await tx.query(
        `SELECT * FROM interview.assistant_evidence e WHERE ${where} AND $2=ANY(audience) AND to_tsvector('english',text) @@ plainto_tsquery('english',$4) AND NOT EXISTS (SELECT 1 FROM interview.assistant_evidence newer WHERE (newer.tenant_id,newer.actor_id,newer.product_id,newer.id)=(e.tenant_id,e.actor_id,e.product_id,e.id) AND newer.revision>e.revision) ORDER BY id LIMIT $5`,
        [...values(scope), query, limit],
      );
      return rows.map(source);
    });
  }
}
