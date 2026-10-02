import { createHash, randomUUID } from "node:crypto";
import {
  jsonValueSchema,
  type ProductErrorStatus,
  ProductOperationError,
} from "@omnitech-assistant/contracts";
import {
  generatedAnswerSchema,
  type InterviewProvenance,
  interviewMetricSchema,
  interviewProvenanceSchema,
} from "@omnitech/interview-contracts";
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
  metrics: z.array(interviewMetricSchema).max(128).optional(),
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
  provenance: InterviewProvenance | null;
}>;
export type AnswerRevisionRecord = Readonly<{
  workspaceId: string;
  artifactId: string;
  savedRevision: number;
  draftRevision: number;
  value: InterviewDraft;
  createdAt: string;
  provenance: InterviewProvenance | null;
}>;
// Advice the model sees when a proposal is refused, so it can fix the next one.
const refusalHints: Readonly<Record<string, string>> = {
  "missing-citation":
    'Add a top-level `claims` list beside `answer` in the arguments. Each claim is {"field":"answerMarkdown","text":"<exact words from that answer field>","source":"<evidence id>","quote":"<passage from that evidence that supports the text>"}. You do not supply hashes or revisions.',
  "citation-quote-conflict":
    "Each citation quote must be copied exactly, character for character, from that evidence's text.",
  "evidence-hash-conflict":
    "Copy each citation's sha256 exactly from the evidence you were given.",
  "claim-text-conflict":
    "Each claim's text must appear exactly in the answer field it names.",
  "claim-answer-required":
    "Claims describe an answer; include the answer in the same patch.",
  "unsupported-metric":
    "Do not state numbers or metrics that are not in the provided candidate evidence.",
  "candidate-fact-conflict":
    "Facts about the candidate need candidate evidence; remove them or mark them uncertain.",
  "no-change":
    "The proposal equals the current draft. Tell the user nothing needs to change.",
  "changed-since":
    "The draft was edited after this change was applied, so undoing it would overwrite those edits.",
};
export class WorkspaceError extends ProductOperationError {
  constructor(code: string, hint?: string) {
    const status: ProductErrorStatus =
      code === "not-found"
        ? 404
        : code === "evidence-forbidden"
          ? 403
          : code === "runner-unavailable"
            ? 501
            : [
                  "revision-conflict",
                  "idempotency-conflict",
                  "effect-interrupted",
                  "effect-conflict",
                  "evidence-revision-conflict",
                  "changed-since",
                ].includes(code)
              ? 409
              : 400;
    super(code, status, hint ?? refusalHints[code]);
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
  provenance: row["provenance"]
    ? interviewProvenanceSchema.parse(row["provenance"])
    : null,
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
    ...(Array.isArray(row["metrics"]) && row["metrics"].length
      ? { metrics: row["metrics"] }
      : {}),
  });

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export class InterviewWorkspaceRepository {
  constructor(private readonly database: WorkspaceDatabasePort) {}
  private async bind(tx: WorkspaceTransaction, scope: WorkspaceScope) {
    await tx.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.product_id',$2,true)",
      [scope.actorId, scope.productId],
    );
  }
  transaction<T>(
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
    return this.transaction(scope, (tx, scope) =>
      this.readTransaction(tx, scope, workspaceId, artifactId),
    );
  }
  async readTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    workspaceId: string,
    artifactId: string,
    lock = false,
  ): Promise<WorkspaceDraftRecord> {
    scope = scopeSchema.parse(scope);
    workspaceId = id.parse(workspaceId);
    artifactId = id.parse(artifactId);
    await this.bind(tx, scope);
    const [row] = await tx.query(
      `SELECT * FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5${lock ? " FOR UPDATE" : ""}`,
      [...values(scope), workspaceId, artifactId],
    );
    if (!row) throw new WorkspaceError("not-found");
    return draft(row);
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
      `UPDATE interview.assistant_drafts SET value=$7::jsonb,revision=revision+1,updated_at=now(),provenance=CASE WHEN $8::boolean THEN NULL WHEN provenance IS NOT NULL THEN jsonb_set(provenance,'{draftRevision}',to_jsonb(revision+1)) ELSE NULL END WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND revision=$6 RETURNING *`,
      [
        ...values(scope),
        origin.workspaceId,
        origin.artifactId,
        origin.artifactRevision,
        JSON.stringify(value),
        validated.answer !== undefined || validated.question !== undefined,
      ],
    );
    if (!updated) throw new WorkspaceError("revision-conflict");
    return draft(updated);
  }
  // Remember what an applied proposal replaced, in the same transaction as the
  // edit, so undo puts back exactly that.
  async rememberReplacedTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    proposalId: string,
    applied: WorkspaceDraftRecord,
    previous: WorkspaceDraftRecord,
  ): Promise<void> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    await tx.query(
      `INSERT INTO interview.assistant_reverts (tenant_id,actor_id,product_id,proposal_id,workspace_id,artifact_id,applied_revision,previous_value,previous_provenance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       ON CONFLICT (tenant_id,actor_id,product_id,proposal_id) DO UPDATE SET applied_revision=EXCLUDED.applied_revision,previous_value=EXCLUDED.previous_value,previous_provenance=EXCLUDED.previous_provenance,reverted_revision=NULL`,
      [
        ...values(scope),
        id.parse(proposalId),
        applied.origin.workspaceId,
        applied.origin.artifactId,
        applied.origin.artifactRevision,
        JSON.stringify(previous.value),
        previous.provenance ? JSON.stringify(previous.provenance) : null,
      ],
    );
  }
  // Put back what a proposal replaced, unless the draft changed since.
  async revertTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    proposalId: string,
  ): Promise<WorkspaceDraftRecord> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    const [stored] = await tx.query(
      `SELECT * FROM interview.assistant_reverts WHERE ${where} AND proposal_id=$4 FOR UPDATE`,
      [...values(scope), id.parse(proposalId)],
    );
    if (!stored) throw new WorkspaceError("not-found");
    const [row] = await tx.query(
      `SELECT revision FROM interview.assistant_drafts WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 FOR UPDATE`,
      [...values(scope), stored["workspace_id"], stored["artifact_id"]],
    );
    if (!row) throw new WorkspaceError("not-found");
    if (Number(row["revision"]) !== Number(stored["applied_revision"]))
      throw new WorkspaceError("changed-since");
    const [updated] = await tx.query(
      `UPDATE interview.assistant_drafts SET value=$6::jsonb,provenance=$7::jsonb,revision=revision+1,updated_at=now() WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 RETURNING *`,
      [
        ...values(scope),
        stored["workspace_id"],
        stored["artifact_id"],
        JSON.stringify(stored["previous_value"]),
        stored["previous_provenance"]
          ? JSON.stringify(stored["previous_provenance"])
          : null,
      ],
    );
    const restored = draft(updated!);
    await tx.query(
      `UPDATE interview.assistant_reverts SET reverted_revision=$5 WHERE ${where} AND proposal_id=$4`,
      [
        ...values(scope),
        id.parse(proposalId),
        restored.origin.artifactRevision,
      ],
    );
    return restored;
  }
  // The draft revision an undo of this proposal produced, if it was undone.
  async revertedRevisionTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    proposalId: string,
  ): Promise<number | undefined> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    const [row] = await tx.query(
      `SELECT reverted_revision FROM interview.assistant_reverts WHERE ${where} AND proposal_id=$4`,
      [...values(scope), id.parse(proposalId)],
    );
    return row?.["reverted_revision"] == null
      ? undefined
      : Number(row["reverted_revision"]);
  }
  async save(
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    requestId: string = randomUUID(),
  ): Promise<AnswerRevisionRecord> {
    return this.transaction(scope, (tx, scope) =>
      this.saveTransaction(tx, scope, origin, requestId),
    );
  }
  async saveTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    requestId: string,
  ): Promise<AnswerRevisionRecord> {
    scope = scopeSchema.parse(scope);
    origin = originSchema.parse(origin);
    requestId = id.parse(requestId);
    await this.bind(tx, scope);
    const effect = await this.beginEffectTransaction(
      tx,
      scope,
      "save",
      requestId,
      origin,
    );
    if (!effect.fresh) {
      if (effect.state !== "completed")
        throw new WorkspaceError("effect-interrupted");
      return effect.result as AnswerRevisionRecord;
    }
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
      "INSERT INTO interview.assistant_answer_revisions (tenant_id,actor_id,product_id,workspace_id,artifact_id,saved_revision,draft_revision,value,provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *",
      [
        ...values(scope),
        origin.workspaceId,
        origin.artifactId,
        counter!["saved_revision"],
        origin.artifactRevision,
        JSON.stringify(value),
        JSON.stringify(row["provenance"] ?? null),
      ],
    );
    const result = this.answerRevision(saved!);
    await this.completeEffectTransaction(tx, scope, "save", requestId, result);
    return result;
  }
  private answerRevision(row: Record<string, unknown>): AnswerRevisionRecord {
    return {
      workspaceId: String(row["workspace_id"]),
      artifactId: String(row["artifact_id"]),
      savedRevision: Number(row["saved_revision"]),
      draftRevision: Number(row["draft_revision"]),
      value: interviewDraftSchema.parse(row["value"]),
      createdAt: timestamp(row["created_at"]),
      provenance: row["provenance"]
        ? interviewProvenanceSchema.parse(row["provenance"])
        : null,
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
  async listAnswerRevisions(
    scope: WorkspaceScope,
    workspaceId: string,
    artifactId: string,
  ): Promise<readonly AnswerRevisionRecord[]> {
    return this.transaction(scope, async (tx, scope) => {
      const rows = await tx.query(
        `SELECT * FROM interview.assistant_answer_revisions WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 ORDER BY saved_revision DESC LIMIT 100`,
        [...values(scope), id.parse(workspaceId), id.parse(artifactId)],
      );
      return rows.map((row) => this.answerRevision(row));
    });
  }
  async putEvidence(
    scope: WorkspaceScope,
    evidence: InterviewEvidence,
  ): Promise<void> {
    await this.transaction(scope, (tx, scope) =>
      this.putEvidenceTransaction(tx, scope, evidence),
    );
  }
  async putEvidenceTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    evidence: InterviewEvidence,
  ): Promise<void> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    const validated = evidenceSchema.parse(evidence);
    if (
      createHash("sha256").update(validated.text).digest("hex") !==
      validated.sha256
    )
      throw new WorkspaceError("evidence-hash-conflict");
    await this.lockEvidence(tx, scope, validated.id);
    await tx.query(
      "INSERT INTO interview.assistant_evidence (tenant_id,actor_id,product_id,id,revision,sha256,locator,text,source_kind,classification,audience,metrics) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)",
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
        JSON.stringify(validated.metrics ?? []),
      ],
    );
  }
  async readEvidence(
    scope: WorkspaceScope,
    evidenceId: string,
    evidenceRevision: number,
  ): Promise<InterviewEvidence> {
    evidenceId = id.parse(evidenceId);
    revision.parse(evidenceRevision);
    return this.transaction(scope, (tx, scope) =>
      this.readEvidenceTransaction(tx, scope, evidenceId, evidenceRevision),
    );
  }
  private async lockEvidence(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    evidenceId: string,
  ): Promise<void> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([...values(scope), "evidence", evidenceId]),
    ]);
  }
  async readEvidenceTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    evidenceId: string,
    evidenceRevision: number,
    currentOnly = true,
  ): Promise<InterviewEvidence> {
    scope = scopeSchema.parse(scope);
    evidenceId = id.parse(evidenceId);
    revision.parse(evidenceRevision);
    await this.bind(tx, scope);
    await this.lockEvidence(tx, scope, evidenceId);
    const [row] = await tx.query(
      `SELECT * FROM interview.assistant_evidence WHERE ${where} AND id=$4 AND revision=$5`,
      [...values(scope), evidenceId, evidenceRevision],
    );
    if (!row) throw new WorkspaceError("not-found");
    const evidence = source(row);
    if (!evidence.audience.includes(scope.actorId))
      throw new WorkspaceError("evidence-forbidden");
    const newer = await tx.query(
      `SELECT revision FROM interview.assistant_evidence WHERE ${where} AND id=$4 AND revision>$5 LIMIT 1`,
      [...values(scope), evidenceId, evidenceRevision],
    );
    if (currentOnly && newer.length)
      throw new WorkspaceError("evidence-revision-conflict");
    return evidence;
  }
  async latestEvidenceTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    evidenceId: string,
  ): Promise<InterviewEvidence> {
    scope = scopeSchema.parse(scope);
    evidenceId = id.parse(evidenceId);
    await this.bind(tx, scope);
    await this.lockEvidence(tx, scope, evidenceId);
    const [row] = await tx.query(
      `SELECT * FROM interview.assistant_evidence WHERE ${where} AND id=$4 ORDER BY revision DESC LIMIT 1`,
      [...values(scope), evidenceId],
    );
    if (!row) throw new WorkspaceError("not-found");
    const evidence = source(row);
    if (!evidence.audience.includes(scope.actorId))
      throw new WorkspaceError("evidence-forbidden");
    return evidence;
  }
  async evidenceTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    query?: string,
  ): Promise<readonly InterviewEvidence[]> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    const rows = await tx.query(
      `SELECT * FROM interview.assistant_evidence e WHERE ${where} AND $2=ANY(audience) AND ($4::text IS NULL OR to_tsvector('english',text) @@ plainto_tsquery('english',$4)) AND NOT EXISTS (SELECT 1 FROM interview.assistant_evidence newer WHERE (newer.tenant_id,newer.actor_id,newer.product_id,newer.id)=(e.tenant_id,e.actor_id,e.product_id,e.id) AND newer.revision>e.revision) ORDER BY id LIMIT 64`,
      [...values(scope), query ?? null],
    );
    return rows.map(source);
  }
  async setProvenanceTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    provenance: InterviewProvenance,
  ): Promise<void> {
    scope = scopeSchema.parse(scope);
    origin = originSchema.parse(origin);
    provenance = interviewProvenanceSchema.parse(provenance);
    await this.bind(tx, scope);
    if (provenance.draftRevision !== origin.artifactRevision)
      throw new WorkspaceError("revision-conflict");
    const rows = await tx.query(
      `UPDATE interview.assistant_drafts SET provenance=$7::jsonb WHERE ${where} AND workspace_id=$4 AND artifact_id=$5 AND revision=$6 RETURNING revision`,
      [
        ...values(scope),
        origin.workspaceId,
        origin.artifactId,
        origin.artifactRevision,
        JSON.stringify(provenance),
      ],
    );
    if (!rows.length) throw new WorkspaceError("revision-conflict");
  }
  async beginEffectTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    operation: "save" | "run-code",
    requestId: string,
    payload: unknown,
  ) {
    scope = scopeSchema.parse(scope);
    requestId = id.parse(requestId);
    await this.bind(tx, scope);
    jsonValueSchema.parse(payload);
    const encoded = canonicalJson(payload);
    const fingerprint = createHash("sha256").update(encoded).digest("hex");
    const existing = await this.readEffectTransaction(
      tx,
      scope,
      operation,
      requestId,
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new WorkspaceError("idempotency-conflict");
      return { fresh: false, ...existing };
    }
    const receiptId = randomUUID();
    await tx.query(
      "INSERT INTO interview.assistant_effect_receipts(tenant_id,actor_id,product_id,operation,request_id,id,fingerprint,payload,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'started')",
      [...values(scope), operation, requestId, receiptId, fingerprint, encoded],
    );
    return {
      fresh: true,
      id: receiptId,
      state: "started",
      result: null,
      payload,
    };
  }
  async readEffectTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    operation: "save" | "run-code",
    requestId: string,
  ) {
    scope = scopeSchema.parse(scope);
    requestId = id.parse(requestId);
    await this.bind(tx, scope);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([...values(scope), operation, requestId]),
    ]);
    const [row] = await tx.query(
      `SELECT * FROM interview.assistant_effect_receipts WHERE ${where} AND operation=$4 AND request_id=$5 FOR UPDATE`,
      [...values(scope), operation, requestId],
    );
    if (!row) return null;
    jsonValueSchema.parse(row["payload"]);
    const fingerprint = createHash("sha256")
      .update(canonicalJson(row["payload"]))
      .digest("hex");
    if (fingerprint !== row["fingerprint"])
      throw new WorkspaceError("effect-fingerprint-conflict");
    return {
      id: String(row["id"]),
      state: String(row["state"]),
      result: row["result"],
      payload: row["payload"],
      fingerprint,
    };
  }
  async completeEffectTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    operation: "save" | "run-code",
    requestId: string,
    result: unknown,
  ): Promise<void> {
    scope = scopeSchema.parse(scope);
    requestId = id.parse(requestId);
    await this.bind(tx, scope);
    jsonValueSchema.parse(result);
    const rows = await tx.query(
      `UPDATE interview.assistant_effect_receipts SET state='completed',result=$6::jsonb,updated_at=now() WHERE ${where} AND operation=$4 AND request_id=$5 AND state='started' RETURNING id`,
      [...values(scope), operation, requestId, JSON.stringify(result)],
    );
    if (!rows.length) throw new WorkspaceError("effect-conflict");
  }
  async interruptEffect(
    scope: WorkspaceScope,
    requestId: string,
  ): Promise<void> {
    requestId = id.parse(requestId);
    await this.transaction(scope, async (tx, scope) => {
      await tx.query(
        `UPDATE interview.assistant_effect_receipts SET state='interrupted',updated_at=now() WHERE ${where} AND operation='run-code' AND request_id=$4 AND state='started'`,
        [...values(scope), requestId],
      );
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
