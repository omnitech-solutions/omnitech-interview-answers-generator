import { randomUUID } from "node:crypto";
import { enterTenant } from "@omnitech/database";
import {
  type InterviewProvenance,
  interviewProvenanceSchema,
} from "@omnitech/interview-contracts";
import { jsonValueSchema } from "@omnitech-assistant/contracts";
import { z } from "zod";
import {
  canonicalJson,
  draftTitle,
  fingerprintOf,
  runSummary,
  saveRefusal,
  textMatchesHash,
} from "./domain/draft";
import {
  bindProduct,
  incrementSavedRevision,
  insertAnswerRevision,
  insertDraft,
  listAnswerRevisionRows,
  listDraftRows,
  markReverted,
  restoreDraft,
  selectAnswerRevision,
  selectDraft,
  selectDraftRevisionForUpdate,
  selectRevertedRevision,
  selectRevertForUpdate,
  updateDraftProvenance,
  updateDraftValue,
  upsertRevert,
} from "./repositories/drafts.repository";
import {
  completeEffectReceipt,
  insertEffectReceipt,
  interruptRunCodeReceipt,
  latestCompletedRunRows,
  lockEffect,
  selectEffectReceiptForUpdate,
} from "./repositories/effect-receipts.repository";
import {
  currentEvidenceRows,
  insertEvidence,
  lockEvidence,
  searchEvidenceRows,
  selectEvidenceRevision,
  selectLatestEvidence,
  selectNewerEvidence,
} from "./repositories/evidence.repository";

import {
  type AnswerRevisionRecord,
  type DraftSummary,
  draft,
  evidenceSchema,
  type InterviewDraft,
  type InterviewDraftPatch,
  type InterviewEvidence,
  id,
  interviewDraftPatchSchema,
  interviewDraftSchema,
  originSchema,
  revision,
  scopeSchema,
  source,
  timestamp,
  type WorkspaceDatabasePort,
  type WorkspaceDraftRecord,
  WorkspaceError,
  type WorkspaceOrigin,
  type WorkspaceScope,
  type WorkspaceTransaction,
  withRenderedAnswer,
} from "./workspace-contracts";

// Only what this module exported before its contracts moved out: the row
// mappers and schemas beside them stay internal.
export {
  type AnswerRevisionRecord,
  type DraftSummary,
  type InterviewDraft,
  type InterviewDraftPatch,
  type InterviewEvidence,
  interviewDraftPatchSchema,
  interviewDraftSchema,
  type RunSummary,
  type WorkspaceDatabasePort,
  type WorkspaceDraftRecord,
  WorkspaceError,
  type WorkspaceOrigin,
  type WorkspaceScope,
  type WorkspaceTransaction,
} from "./workspace-contracts";

// The Workspace's use cases over one person's drafts, evidence and effect
// receipts. Each public method is one tenant transaction bound to the scope;
// the `*Transaction` methods join a transaction the caller already holds. The
// statements live in ./repositories, the rules that need no database in
// ./domain.
export class InterviewWorkspaceRepository {
  constructor(private readonly database: WorkspaceDatabasePort) {}
  // Workspace rows are pinned to tenant, actor and product by row-level
  // security. The database package owns the tenant and actor settings
  // (ADR-0005); the product id is this product's own narrow setting.
  private async bind(tx: WorkspaceTransaction, scope: WorkspaceScope) {
    await enterTenant(tx, { tenantId: scope.tenantId, actorId: scope.actorId });
    await bindProduct(tx, scope.productId);
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
      briefing?: InterviewDraft["briefing"];
    },
  ): Promise<WorkspaceDraftRecord> {
    return this.transaction(scope, (tx, scope) =>
      this.createTransaction(tx, scope, origin, initial),
    );
  }
  async createTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    origin: WorkspaceOrigin,
    initial: {
      question: string;
      notes?: string;
      answer?: InterviewDraft["answer"];
      briefing?: InterviewDraft["briefing"];
    },
  ): Promise<WorkspaceDraftRecord> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    origin = originSchema.parse(origin);
    if (origin.artifactRevision !== 0)
      throw new WorkspaceError("revision-conflict");
    const value = withRenderedAnswer(interviewDraftSchema.parse(initial));
    const [row] = await insertDraft(
      tx,
      scope,
      origin.workspaceId,
      origin.artifactId,
      value,
    );
    return draft(row!);
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
    const [row] = await selectDraft(tx, scope, workspaceId, artifactId, lock);
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
    const [row] = await selectDraft(
      tx,
      scope,
      origin.workspaceId,
      origin.artifactId,
      true,
    );
    if (!row) throw new WorkspaceError("not-found");
    if (Number(row["revision"]) !== origin.artifactRevision)
      throw new WorkspaceError("revision-conflict");
    const current = interviewDraftSchema.parse(row["value"]);
    const value = withRenderedAnswer(
      interviewDraftSchema.parse({ ...current, ...validated }),
    );
    const [updated] = await updateDraftValue(
      tx,
      scope,
      origin,
      value,
      validated.answer !== undefined ||
        validated.briefing !== undefined ||
        validated.question !== undefined,
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
    await upsertRevert(tx, scope, {
      proposalId: id.parse(proposalId),
      workspaceId: applied.origin.workspaceId,
      artifactId: applied.origin.artifactId,
      appliedRevision: applied.origin.artifactRevision,
      previousValue: previous.value,
      previousProvenance: previous.provenance,
    });
  }
  // Put back what a proposal replaced, unless the draft changed since.
  async revertTransaction(
    tx: WorkspaceTransaction,
    scope: WorkspaceScope,
    proposalId: string,
  ): Promise<WorkspaceDraftRecord> {
    scope = scopeSchema.parse(scope);
    await this.bind(tx, scope);
    const [stored] = await selectRevertForUpdate(
      tx,
      scope,
      id.parse(proposalId),
    );
    if (!stored) throw new WorkspaceError("not-found");
    const [row] = await selectDraftRevisionForUpdate(
      tx,
      scope,
      stored["workspace_id"],
      stored["artifact_id"],
    );
    if (!row) throw new WorkspaceError("not-found");
    if (Number(row["revision"]) !== Number(stored["applied_revision"]))
      throw new WorkspaceError("changed-since");
    const [updated] = await restoreDraft(
      tx,
      scope,
      stored["workspace_id"],
      stored["artifact_id"],
      stored["previous_value"],
      stored["previous_provenance"],
    );
    const restored = draft(updated!);
    await markReverted(
      tx,
      scope,
      id.parse(proposalId),
      restored.origin.artifactRevision,
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
    const [row] = await selectRevertedRevision(tx, scope, id.parse(proposalId));
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
    const [row] = await selectDraft(
      tx,
      scope,
      origin.workspaceId,
      origin.artifactId,
      true,
    );
    if (!row) throw new WorkspaceError("not-found");
    if (Number(row["revision"]) !== origin.artifactRevision)
      throw new WorkspaceError("revision-conflict");
    const value = interviewDraftSchema.parse(row["value"]);
    const refusal = saveRefusal(value);
    if (refusal) throw new WorkspaceError(refusal);
    const [counter] = await incrementSavedRevision(
      tx,
      scope,
      origin.workspaceId,
      origin.artifactId,
    );
    const [saved] = await insertAnswerRevision(tx, scope, {
      workspaceId: origin.workspaceId,
      artifactId: origin.artifactId,
      savedRevision: counter!["saved_revision"],
      draftRevision: origin.artifactRevision,
      value,
      provenance: row["provenance"],
    });
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
      const [row] = await selectAnswerRevision(
        tx,
        scope,
        workspaceId,
        artifactId,
        savedRevision,
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
      const rows = await listAnswerRevisionRows(
        tx,
        scope,
        id.parse(workspaceId),
        id.parse(artifactId),
      );
      return rows.map((row) => this.answerRevision(row));
    });
  }
  // The person's drafts in one workspace, newest first, for the studio's
  // question lists. Titles come from the question's first non-empty line.
  async listDrafts(
    scope: WorkspaceScope,
    workspaceId: string,
  ): Promise<readonly DraftSummary[]> {
    return this.transaction(scope, async (tx, scope) => {
      const workspace = id.parse(workspaceId);
      const rows = await listDraftRows(tx, scope, workspace);
      // [DOMAIN] The latest completed run per question, from its receipts.
      const runs = await latestCompletedRunRows(tx, scope, workspace);
      const lastRuns = new Map(
        runs.map((run) => [
          String(run["artifact_id"]),
          runSummary(run["execution"], timestamp(run["updated_at"])),
        ]),
      );
      return rows.map((row) => {
        const value = row["value"] as InterviewDraft;
        return {
          artifactId: String(row["artifact_id"]),
          title: draftTitle(value.question),
          kind: value.briefing ? "briefing" : "coding",
          language: value.answer?.language ?? null,
          revision: Number(row["revision"]),
          updatedAt: timestamp(row["updated_at"]),
          lastRun: lastRuns.get(String(row["artifact_id"])) ?? null,
        } as const;
      });
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
    if (!textMatchesHash(validated.text, validated.sha256))
      throw new WorkspaceError("evidence-hash-conflict");
    await lockEvidence(tx, scope, validated.id);
    await insertEvidence(tx, scope, validated);
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
    await lockEvidence(tx, scope, evidenceId);
    const [row] = await selectEvidenceRevision(
      tx,
      scope,
      evidenceId,
      evidenceRevision,
    );
    if (!row) throw new WorkspaceError("not-found");
    const evidence = source(row);
    if (!evidence.audience.includes(scope.actorId))
      throw new WorkspaceError("evidence-forbidden");
    const newer = await selectNewerEvidence(
      tx,
      scope,
      evidenceId,
      evidenceRevision,
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
    await lockEvidence(tx, scope, evidenceId);
    const [row] = await selectLatestEvidence(tx, scope, evidenceId);
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
    const rows = await currentEvidenceRows(tx, scope, query ?? null);
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
    const rows = await updateDraftProvenance(tx, scope, origin, provenance);
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
    const fingerprint = fingerprintOf(encoded);
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
    await insertEffectReceipt(tx, scope, {
      operation,
      requestId,
      id: receiptId,
      fingerprint,
      payload: encoded,
    });
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
    await lockEffect(tx, scope, operation, requestId);
    const [row] = await selectEffectReceiptForUpdate(
      tx,
      scope,
      operation,
      requestId,
    );
    if (!row) return null;
    jsonValueSchema.parse(row["payload"]);
    const fingerprint = fingerprintOf(canonicalJson(row["payload"]));
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
    const rows = await completeEffectReceipt(
      tx,
      scope,
      operation,
      requestId,
      result,
    );
    if (!rows.length) throw new WorkspaceError("effect-conflict");
  }
  async interruptEffect(
    scope: WorkspaceScope,
    requestId: string,
  ): Promise<void> {
    requestId = id.parse(requestId);
    await this.transaction(scope, async (tx, scope) => {
      await interruptRunCodeReceipt(tx, scope, requestId);
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
      const rows = await searchEvidenceRows(tx, scope, query, limit);
      return rows.map(source);
    });
  }
}
