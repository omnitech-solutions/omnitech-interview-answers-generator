import { createHash, randomUUID } from "node:crypto";
import { type Usage, usageSchema } from "@omnitech/ai-engine";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import { withTenant } from "@omnitech/database";
import {
  type DocumentField,
  type DocumentFormat,
  type DocumentTemplateKind,
  documentFieldsSchema,
  documentTemplateCreateSchema,
  documentValuesSchema,
  validateDocumentValues,
} from "@omnitech/interview-contracts";
import { DocumentArtifactRepository } from "@omnitech/platform-storage";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import {
  documentExports,
  documentGenerationBatches,
  documentGenerationRequests,
  documentRevisions,
  documents,
  documentTemplateRevisions,
  documentTemplates,
} from "../db/documents";

export type DocumentScope = { tenantId: string; actorId: string };
export type TemplateRow = typeof documentTemplates.$inferSelect;
export type TemplateRevisionRow = typeof documentTemplateRevisions.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentRevisionRow = typeof documentRevisions.$inferSelect;
export type DocumentExportRow = typeof documentExports.$inferSelect;

// What a kept batch used, as the engine states usage. A batch kept before
// the engine holds flat counts ({ inputTokens, outputTokens, totalTokens,
// costUsd }): those are read as the counts they are.
export function storedUsage(value: unknown): Usage | null {
  const current = usageSchema.safeParse(value);
  if (current.success) return current.data;
  if (typeof value !== "object" || value === null) return null;
  const flat = value as Record<string, unknown>;
  const count = (key: string) =>
    typeof flat[key] === "number" ? { [key]: flat[key] } : {};
  const counts = {
    ...count("inputTokens"),
    ...count("outputTokens"),
    ...count("totalTokens"),
  };
  const kept = usageSchema.safeParse({
    status: "partial",
    ...counts,
    cost:
      typeof flat["costUsd"] === "number"
        ? { status: "actual", amount: flat["costUsd"], currency: "USD" }
        : { status: "unavailable", reason: "not-reported" },
  });
  return kept.success ? kept.data : null;
}

export class DocumentNotFound extends Error {
  constructor() {
    super("Document not found");
  }
}

export class DocumentRevisionConflict extends Error {
  constructor() {
    super("Document has a newer revision");
  }
}

export class DocumentAlreadyExists extends Error {
  constructor() {
    super("Matching document already exists");
  }
}

export class DocumentSaveCancelled extends Error {
  constructor() {
    super("Document save cancelled");
  }
}

export class DocumentRetryConflict extends Error {
  constructor() {
    super("Document retry key conflicts with another request");
  }
}

export type DocumentRequestIdentity = {
  key: string;
  bindingHash: string;
  sourceDigest: string;
};

function isSelectionConflict(error: unknown): boolean {
  const cause =
    error && typeof error === "object" && "cause" in error
      ? error.cause
      : error;
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      cause.constraint === "documents_selection_key",
  );
}

export type CreateTemplateInput = {
  name: string;
  kind: DocumentTemplateKind;
  format: DocumentFormat;
  sourceArtifactId: string;
  fields: readonly DocumentField[];
  instructions: string;
};
type SourceBytes = { sourceBytes: Uint8Array; sourceArtifactId?: never };
type SourceArtifact = { sourceArtifactId: string; sourceBytes?: never };
type ArtifactSource = SourceBytes | SourceArtifact;

export type ProvisionBuiltInTemplateInput = Omit<
  CreateTemplateInput,
  "sourceArtifactId"
> &
  ArtifactSource & {
    key: string;
  };

// jsonb hands object keys back in its own order, so equal fields must be
// compared without regard to key order.
function sameFields(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`
        : JSON.stringify(value);
  return canonical(left) === canonical(right);
}

function builtInTemplateId(tenantId: string, key: string): string {
  const digest = createHash("sha256")
    .update(`omnitech.interview/document-template/${tenantId}/${key}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export type RevisionContent = {
  values: Record<string, string>;
  provenance: Record<string, unknown>;
  aiUsage?: unknown;
  requestIdentity?: DocumentRequestIdentity;
};

export type CreateDocumentInput = RevisionContent & {
  title: string;
  templateId: string;
  templateRevision: number;
  profileId: string;
  profileRevision: number;
  candidacyId: string | null;
  interviewId: string | null;
  signal?: AbortSignal;
};

const templateKey = (scope: DocumentScope, templateId: string) =>
  and(
    eq(documentTemplates.tenantId, scope.tenantId),
    eq(documentTemplates.id, templateId),
  );

const documentKey = (scope: DocumentScope, documentId: string) =>
  and(
    eq(documents.tenantId, scope.tenantId),
    eq(documents.ownerUserId, scope.actorId),
    eq(documents.id, documentId),
  );

function fieldsOf(revision: TemplateRevisionRow): DocumentField[] {
  return documentFieldsSchema.parse(revision.fields);
}

function checkedContent(
  fields: readonly DocumentField[],
  content: RevisionContent,
) {
  const values = documentValuesSchema.parse(content.values);
  return {
    values,
    provenance: content.provenance,
    validation: validateDocumentValues(fields, values),
    aiUsage: content.aiUsage ?? null,
  };
}

export class InterviewDocumentRepository {
  constructor(private readonly database: PlatformDatabase) {}

  private createArtifact(
    db: TenantDatabase,
    scope: DocumentScope,
    artifactType:
      | "interview.document-template-source"
      | "interview.document-export",
    title: string,
    bytes: Uint8Array,
    metadata?: Record<string, unknown>,
  ) {
    return new DocumentArtifactRepository(
      this.database,
    ).createInTenantTransaction(db, {
      ...scope,
      artifactType,
      title,
      bytes,
      ...(metadata ? { metadata } : {}),
    });
  }

  private inScope<T>(
    scope: DocumentScope,
    work: (db: TenantDatabase) => Promise<T>,
  ) {
    return withTenant({ ...scope, productId: INTERVIEW_PRODUCT_ID }, work, {
      database: this.database,
    });
  }

  async getGenerationRequest(
    scope: DocumentScope,
    key: string,
    bindingHash: string,
  ): Promise<{ documentId: string; revision: number } | null | undefined> {
    return this.inScope(scope, async (db) => {
      const [row] = await db
        .select()
        .from(documentGenerationRequests)
        .where(
          and(
            eq(documentGenerationRequests.tenantId, scope.tenantId),
            eq(documentGenerationRequests.ownerUserId, scope.actorId),
            eq(documentGenerationRequests.retryKey, key),
          ),
        )
        .limit(1);
      if (!row) return undefined;
      if (row.bindingHash !== bindingHash) throw new DocumentRetryConflict();
      return row.documentId && row.revision
        ? { documentId: row.documentId, revision: row.revision }
        : null;
    });
  }

  async reserveGeneration(
    scope: DocumentScope,
    identity: DocumentRequestIdentity,
  ): Promise<void> {
    await this.inScope(scope, async (db) => {
      await db
        .insert(documentGenerationRequests)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          retryKey: identity.key,
          bindingHash: identity.bindingHash,
          sourceDigest: identity.sourceDigest,
        })
        .onConflictDoNothing();
      const [row] = await db
        .select()
        .from(documentGenerationRequests)
        .where(
          and(
            eq(documentGenerationRequests.tenantId, scope.tenantId),
            eq(documentGenerationRequests.ownerUserId, scope.actorId),
            eq(documentGenerationRequests.retryKey, identity.key),
          ),
        )
        .limit(1);
      if (
        !row ||
        row.bindingHash !== identity.bindingHash ||
        row.sourceDigest !== identity.sourceDigest ||
        row.documentId
      )
        throw new DocumentRetryConflict();
    });
  }

  async getGenerationBatches(
    scope: DocumentScope,
    identity: DocumentRequestIdentity,
  ): Promise<
    Record<
      string,
      {
        fieldsHash: string;
        values: Record<string, string>;
        usage?: Usage | null;
      }
    >
  > {
    return this.inScope(scope, async (db) => {
      const [request] = await db
        .select()
        .from(documentGenerationRequests)
        .where(
          and(
            eq(documentGenerationRequests.tenantId, scope.tenantId),
            eq(documentGenerationRequests.ownerUserId, scope.actorId),
            eq(documentGenerationRequests.retryKey, identity.key),
            eq(documentGenerationRequests.bindingHash, identity.bindingHash),
            eq(documentGenerationRequests.sourceDigest, identity.sourceDigest),
            isNull(documentGenerationRequests.documentId),
          ),
        )
        .limit(1);
      if (!request) throw new DocumentRetryConflict();
      const rows = await db
        .select()
        .from(documentGenerationBatches)
        .where(
          and(
            eq(documentGenerationBatches.tenantId, scope.tenantId),
            eq(documentGenerationBatches.ownerUserId, scope.actorId),
            eq(documentGenerationBatches.retryKey, identity.key),
          ),
        );
      return Object.fromEntries(
        rows.map((row) => [
          row.batchId,
          {
            fieldsHash: row.fieldsHash,
            values: row.values,
            usage: storedUsage(row.usage),
          },
        ]),
      );
    });
  }

  async saveGenerationBatch(
    scope: DocumentScope,
    identity: DocumentRequestIdentity,
    batch: {
      id: string;
      fieldsHash: string;
      values: Record<string, string>;
      usage?: Usage | null;
    },
  ): Promise<void> {
    await this.inScope(scope, async (db) => {
      const [request] = await db
        .select()
        .from(documentGenerationRequests)
        .where(
          and(
            eq(documentGenerationRequests.tenantId, scope.tenantId),
            eq(documentGenerationRequests.ownerUserId, scope.actorId),
            eq(documentGenerationRequests.retryKey, identity.key),
            eq(documentGenerationRequests.bindingHash, identity.bindingHash),
            eq(documentGenerationRequests.sourceDigest, identity.sourceDigest),
            isNull(documentGenerationRequests.documentId),
          ),
        )
        .limit(1);
      if (!request) throw new DocumentRetryConflict();
      await db
        .insert(documentGenerationBatches)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          retryKey: identity.key,
          batchId: batch.id,
          fieldsHash: batch.fieldsHash,
          values: batch.values,
          usage: batch.usage,
        })
        .onConflictDoNothing();
      const [stored] = await db
        .select()
        .from(documentGenerationBatches)
        .where(
          and(
            eq(documentGenerationBatches.tenantId, scope.tenantId),
            eq(documentGenerationBatches.ownerUserId, scope.actorId),
            eq(documentGenerationBatches.retryKey, identity.key),
            eq(documentGenerationBatches.batchId, batch.id),
          ),
        )
        .limit(1);
      if (
        !stored ||
        stored.fieldsHash !== batch.fieldsHash ||
        Object.keys(stored.values).length !==
          Object.keys(batch.values).length ||
        Object.entries(batch.values).some(
          ([key, value]) => stored.values[key] !== value,
        )
      )
        throw new DocumentRetryConflict();
    });
  }

  private async commitGenerationRequest(
    db: TenantDatabase,
    scope: DocumentScope,
    identity: DocumentRequestIdentity | undefined,
    documentId: string,
    revision: number,
  ): Promise<void> {
    if (!identity) return;
    const [committed] = await db
      .update(documentGenerationRequests)
      .set({ documentId, revision })
      .where(
        and(
          eq(documentGenerationRequests.tenantId, scope.tenantId),
          eq(documentGenerationRequests.ownerUserId, scope.actorId),
          eq(documentGenerationRequests.retryKey, identity.key),
          eq(documentGenerationRequests.bindingHash, identity.bindingHash),
          eq(documentGenerationRequests.sourceDigest, identity.sourceDigest),
          isNull(documentGenerationRequests.documentId),
        ),
      )
      .returning({ key: documentGenerationRequests.retryKey });
    if (!committed) throw new DocumentRetryConflict();
  }

  async listTemplates(scope: DocumentScope): Promise<
    Array<{
      template: TemplateRow;
      latestRevision: number;
      fieldCount: number;
      revisions: Array<{ revision: number; createdAt: Date }>;
    }>
  > {
    return this.inScope(scope, async (db) => {
      const templates = await db
        .select()
        .from(documentTemplates)
        .where(eq(documentTemplates.tenantId, scope.tenantId));
      const revisions = await db
        .select({
          templateId: documentTemplateRevisions.templateId,
          revision: documentTemplateRevisions.revision,
          fields: documentTemplateRevisions.fields,
          createdAt: documentTemplateRevisions.createdAt,
        })
        .from(documentTemplateRevisions)
        .where(eq(documentTemplateRevisions.tenantId, scope.tenantId));
      const history = new Map<
        string,
        Array<{ revision: number; createdAt: Date; fieldCount: number }>
      >();
      for (const item of revisions)
        history.set(item.templateId, [
          ...(history.get(item.templateId) ?? []),
          {
            revision: item.revision,
            createdAt: item.createdAt,
            fieldCount: Array.isArray(item.fields) ? item.fields.length : 0,
          },
        ]);
      return templates.map((template) => {
        const own = (history.get(template.id) ?? []).sort(
          (a, b) => b.revision - a.revision,
        );
        return {
          template,
          latestRevision: own[0]?.revision ?? 0,
          fieldCount: own[0]?.fieldCount ?? 0,
          revisions: own.map(({ revision, createdAt }) => ({
            revision,
            createdAt,
          })),
        };
      });
    });
  }

  async getTemplateRevision(
    scope: DocumentScope,
    templateId: string,
    revision?: number,
  ): Promise<{
    template: TemplateRow;
    revision: TemplateRevisionRow;
    fields: DocumentField[];
  } | null> {
    return this.inScope(scope, async (db) => {
      const [template] = await db
        .select()
        .from(documentTemplates)
        .where(templateKey(scope, templateId))
        .limit(1);
      if (!template) return null;
      const [row] = await db
        .select()
        .from(documentTemplateRevisions)
        .where(
          and(
            eq(documentTemplateRevisions.tenantId, scope.tenantId),
            eq(documentTemplateRevisions.templateId, templateId),
            ...(revision === undefined
              ? []
              : [eq(documentTemplateRevisions.revision, revision)]),
          ),
        )
        .orderBy(desc(documentTemplateRevisions.revision))
        .limit(1);
      return row ? { template, revision: row, fields: fieldsOf(row) } : null;
    });
  }

  async createTemplate(
    scope: DocumentScope,
    input: Omit<CreateTemplateInput, "sourceArtifactId"> & ArtifactSource,
  ): Promise<{
    template: TemplateRow;
    revision: TemplateRevisionRow;
  }> {
    const metadata = documentTemplateCreateSchema.parse({
      name: input.name,
      kind: input.kind,
      format: input.format,
      instructions: input.instructions,
    });
    const fields = documentFieldsSchema.parse(input.fields);
    return this.inScope(scope, async (db) => {
      const sourceArtifactId = input.sourceBytes
        ? await this.createArtifact(
            db,
            scope,
            "interview.document-template-source",
            metadata.name,
            input.sourceBytes,
          )
        : input.sourceArtifactId;
      const [template] = await db
        .insert(documentTemplates)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          name: metadata.name,
          kind: metadata.kind,
          format: metadata.format,
        })
        .returning();
      if (!template) throw new Error("Template insert did not return a row");
      const [revision] = await db
        .insert(documentTemplateRevisions)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          templateId: template.id,
          revision: 1,
          sourceArtifactId,
          fields,
          instructions: metadata.instructions,
        })
        .returning();
      if (!revision)
        throw new Error("Template revision insert did not return a row");
      return { template, revision };
    });
  }

  // Called only by server-controlled catalog seeding. The key and artifact
  // come from application code; neither is accepted from a member request.
  async provisionBuiltInTemplate(
    scope: DocumentScope,
    input: ProvisionBuiltInTemplateInput,
  ): Promise<{ template: TemplateRow; revision: TemplateRevisionRow }> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.key))
      throw new Error("Built-in template key is invalid");
    const metadata = documentTemplateCreateSchema.parse({
      name: input.name,
      kind: input.kind,
      format: input.format,
      instructions: input.instructions,
    });
    const fields = documentFieldsSchema.parse(input.fields);
    const id = builtInTemplateId(scope.tenantId, input.key);
    return this.inScope(scope, async (db) => {
      await db.execute(
        sql`select set_config('app.document_catalog_provisioner', 'on', true)`,
      );
      // Bytes are content-addressed: a changed file is a new artifact, so
      // updating a built-in appends a revision instead of rewriting history.
      const sourceArtifactId = input.sourceBytes
        ? await new DocumentArtifactRepository(
            this.database,
          ).provisionBuiltInInTenantTransaction(db, {
            tenantId: scope.tenantId,
            key: `${input.key}-${createHash("sha256").update(input.sourceBytes).digest("hex").slice(0, 12)}`,
            title: metadata.name,
            bytes: input.sourceBytes,
          })
        : input.sourceArtifactId;
      await db
        .insert(documentTemplates)
        .values({
          id,
          tenantId: scope.tenantId,
          ownerUserId: null,
          name: metadata.name,
          kind: metadata.kind,
          format: metadata.format,
        })
        .onConflictDoNothing({ target: documentTemplates.id });
      const [template] = await db
        .select()
        .from(documentTemplates)
        .where(templateKey(scope, id))
        .limit(1);
      const [latest] = await db
        .select()
        .from(documentTemplateRevisions)
        .where(
          and(
            eq(documentTemplateRevisions.tenantId, scope.tenantId),
            eq(documentTemplateRevisions.templateId, id),
          ),
        )
        .orderBy(desc(documentTemplateRevisions.revision))
        .limit(1);
      if (
        !template ||
        template.ownerUserId !== null ||
        template.kind !== metadata.kind ||
        template.format !== metadata.format
      )
        throw new Error("Built-in template key already has different content");
      if (
        latest &&
        latest.ownerUserId === null &&
        latest.sourceArtifactId === sourceArtifactId &&
        latest.instructions === metadata.instructions &&
        sameFields(latest.fields, fields)
      )
        return { template, revision: latest };
      const [revision] = await db
        .insert(documentTemplateRevisions)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: null,
          templateId: id,
          revision: (latest?.revision ?? 0) + 1,
          sourceArtifactId,
          fields,
          instructions: metadata.instructions,
        })
        .returning();
      if (!revision)
        throw new Error("Built-in template revision did not return a row");
      return { template, revision };
    });
  }

  async addTemplateRevision(
    scope: DocumentScope,
    input: {
      templateId: string;
      expectedRevision: number;
      fields: readonly DocumentField[];
      instructions: string;
    } & ArtifactSource,
  ): Promise<TemplateRevisionRow> {
    const fields = documentFieldsSchema.parse(input.fields);
    if (input.instructions.length > 16_000)
      throw new Error("Template instructions are too long");
    return this.inScope(scope, async (db) => {
      const locked =
        await db.execute(sql`SELECT id FROM interview.document_templates
        WHERE tenant_id=${scope.tenantId}::uuid AND id=${input.templateId}::uuid
          AND owner_user_id=${scope.actorId}::uuid FOR UPDATE`);
      if (!locked.rows[0]) throw new DocumentNotFound();
      const [latest] = await db
        .select({ revision: documentTemplateRevisions.revision })
        .from(documentTemplateRevisions)
        .where(
          and(
            eq(documentTemplateRevisions.tenantId, scope.tenantId),
            eq(documentTemplateRevisions.templateId, input.templateId),
          ),
        )
        .orderBy(desc(documentTemplateRevisions.revision))
        .limit(1);
      if (latest?.revision !== input.expectedRevision)
        throw new DocumentRevisionConflict();
      const sourceArtifactId = input.sourceBytes
        ? await this.createArtifact(
            db,
            scope,
            "interview.document-template-source",
            input.templateId,
            input.sourceBytes,
          )
        : input.sourceArtifactId;
      const [revision] = await db
        .insert(documentTemplateRevisions)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          templateId: input.templateId,
          revision: input.expectedRevision + 1,
          sourceArtifactId,
          fields,
          instructions: input.instructions,
        })
        .returning();
      if (!revision)
        throw new Error("Template revision insert did not return a row");
      return revision;
    });
  }

  async duplicateTemplate(
    scope: DocumentScope,
    input: { sourceTemplateId: string; name: string } & ArtifactSource,
  ): Promise<{ template: TemplateRow; revision: TemplateRevisionRow }> {
    return this.inScope(scope, async (db) => {
      const [source] = await db
        .select()
        .from(documentTemplates)
        .where(templateKey(scope, input.sourceTemplateId))
        .limit(1);
      if (!source) throw new DocumentNotFound();
      const [sourceRevision] = await db
        .select()
        .from(documentTemplateRevisions)
        .where(
          and(
            eq(documentTemplateRevisions.tenantId, scope.tenantId),
            eq(documentTemplateRevisions.templateId, source.id),
          ),
        )
        .orderBy(desc(documentTemplateRevisions.revision))
        .limit(1);
      if (!sourceRevision) throw new DocumentNotFound();
      const metadata = documentTemplateCreateSchema.parse({
        name: input.name,
        kind: source.kind,
        format: source.format,
        instructions: sourceRevision.instructions,
      });
      const sourceArtifactId = input.sourceBytes
        ? await this.createArtifact(
            db,
            scope,
            "interview.document-template-source",
            metadata.name,
            input.sourceBytes,
          )
        : input.sourceArtifactId;
      const [template] = await db
        .insert(documentTemplates)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          name: metadata.name,
          kind: metadata.kind,
          format: metadata.format,
        })
        .returning();
      if (!template) throw new Error("Template copy did not return a row");
      const [revision] = await db
        .insert(documentTemplateRevisions)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          templateId: template.id,
          revision: 1,
          sourceArtifactId,
          fields: fieldsOf(sourceRevision),
          instructions: sourceRevision.instructions,
        })
        .returning();
      if (!revision)
        throw new Error("Template copy revision did not return a row");
      return { template, revision };
    });
  }

  async listDocuments(scope: DocumentScope): Promise<DocumentRow[]> {
    return this.inScope(scope, (db) =>
      db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, scope.tenantId),
            eq(documents.ownerUserId, scope.actorId),
            sql`EXISTS (
              SELECT 1 FROM interview.candidate_profile_revisions r
              JOIN interview.candidate_profiles p
                ON (p.tenant_id,p.actor_id,p.product_id,p.id)
                 = (r.tenant_id,r.actor_id,r.product_id,r.id)
              WHERE r.tenant_id=${scope.tenantId}::text
                AND r.actor_id=${scope.actorId}::text
                AND r.product_id=${INTERVIEW_PRODUCT_ID}
                AND r.id=${documents.profileId}
                AND r.revision=${documents.profileRevision}
                AND p.revoked_at IS NULL
            )`,
            sql`(${documents.candidacyId} IS NULL OR EXISTS (
              SELECT 1 FROM interview.candidacies c
              JOIN interview.member_people mp
                ON mp.tenant_id=c.tenant_id
               AND mp.person_id=c.candidate_person_id
              WHERE c.tenant_id=${scope.tenantId}::uuid
                AND c.id=${documents.candidacyId}
                AND mp.user_id=${scope.actorId}::uuid
            ))`,
          ),
        )
        .orderBy(desc(documents.updatedAt)),
    );
  }

  async findMatchingDocument(
    scope: DocumentScope,
    input: {
      templateId: string;
      templateRevision: number;
      profileId: string;
      profileRevision: number;
      candidacyId: string | null;
      interviewId: string | null;
    },
  ): Promise<DocumentRow | null> {
    return this.inScope(scope, async (db) => {
      const [row] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, scope.tenantId),
            eq(documents.ownerUserId, scope.actorId),
            eq(documents.templateId, input.templateId),
            eq(documents.templateRevision, input.templateRevision),
            eq(documents.profileId, input.profileId),
            eq(documents.profileRevision, input.profileRevision),
            input.candidacyId
              ? eq(documents.candidacyId, input.candidacyId)
              : isNull(documents.candidacyId),
            input.interviewId
              ? eq(documents.interviewId, input.interviewId)
              : isNull(documents.interviewId),
          ),
        )
        .orderBy(desc(documents.updatedAt))
        .limit(1);
      return row ?? null;
    });
  }

  async getDocument(
    scope: DocumentScope,
    documentId: string,
    revision?: number,
  ): Promise<{
    document: DocumentRow;
    revision: DocumentRevisionRow;
    template: TemplateRow;
    templateRevision: TemplateRevisionRow;
    fields: DocumentField[];
  } | null> {
    return this.inScope(scope, async (db) => {
      const [document] = await db
        .select()
        .from(documents)
        .where(documentKey(scope, documentId))
        .limit(1);
      if (!document) return null;
      const [snapshot] = await db
        .select()
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.tenantId, scope.tenantId),
            eq(documentRevisions.ownerUserId, scope.actorId),
            eq(documentRevisions.documentId, documentId),
            eq(
              documentRevisions.revision,
              revision ?? document.currentRevision,
            ),
          ),
        )
        .limit(1);
      const [template] = await db
        .select()
        .from(documentTemplates)
        .where(templateKey(scope, document.templateId))
        .limit(1);
      const [templateRevision] = await db
        .select()
        .from(documentTemplateRevisions)
        .where(
          and(
            eq(documentTemplateRevisions.tenantId, scope.tenantId),
            eq(documentTemplateRevisions.templateId, document.templateId),
            eq(documentTemplateRevisions.revision, document.templateRevision),
          ),
        )
        .limit(1);
      if (!snapshot || !template || !templateRevision) return null;
      return {
        document,
        revision: snapshot,
        template,
        templateRevision,
        fields: fieldsOf(templateRevision),
      };
    });
  }

  async createDocument(
    scope: DocumentScope,
    input: CreateDocumentInput,
  ): Promise<{ document: DocumentRow; revision: DocumentRevisionRow }> {
    const ensureActive = () => {
      if (input.signal?.aborted) throw new DocumentSaveCancelled();
    };
    ensureActive();
    try {
      return await this.inScope(scope, async (db) => {
        ensureActive();
        const [templateRevision] = await db
          .select()
          .from(documentTemplateRevisions)
          .where(
            and(
              eq(documentTemplateRevisions.tenantId, scope.tenantId),
              eq(documentTemplateRevisions.templateId, input.templateId),
              eq(documentTemplateRevisions.revision, input.templateRevision),
            ),
          )
          .limit(1);
        if (!templateRevision) throw new DocumentNotFound();
        const content = checkedContent(fieldsOf(templateRevision), input);
        const documentId = randomUUID();
        ensureActive();
        const [document] = await db
          .insert(documents)
          .values({
            id: documentId,
            tenantId: scope.tenantId,
            ownerUserId: scope.actorId,
            templateId: input.templateId,
            templateRevision: input.templateRevision,
            profileId: input.profileId,
            profileRevision: input.profileRevision,
            candidacyId: input.candidacyId,
            interviewId: input.interviewId,
            title: input.title.trim(),
            status: content.validation.length ? "invalid" : "ready",
            currentRevision: 1,
          })
          .returning();
        if (!document) throw new Error("Document insert did not return a row");
        ensureActive();
        const [revision] = await db
          .insert(documentRevisions)
          .values({
            tenantId: scope.tenantId,
            ownerUserId: scope.actorId,
            documentId,
            revision: 1,
            ...content,
          })
          .returning();
        if (!revision)
          throw new Error("Document revision insert did not return a row");
        await this.commitGenerationRequest(
          db,
          scope,
          input.requestIdentity,
          documentId,
          1,
        );
        ensureActive();
        return { document, revision };
      });
    } catch (error) {
      if (isSelectionConflict(error)) throw new DocumentAlreadyExists();
      throw error;
    }
  }

  private async appendInTransaction(
    db: TenantDatabase,
    scope: DocumentScope,
    input: { documentId: string; baseRevision: number } & RevisionContent,
  ): Promise<DocumentRevisionRow> {
    const [document] = await db
      .select()
      .from(documents)
      .where(documentKey(scope, input.documentId))
      .limit(1);
    if (!document) throw new DocumentNotFound();
    const [templateRevision] = await db
      .select()
      .from(documentTemplateRevisions)
      .where(
        and(
          eq(documentTemplateRevisions.tenantId, scope.tenantId),
          eq(documentTemplateRevisions.templateId, document.templateId),
          eq(documentTemplateRevisions.revision, document.templateRevision),
        ),
      )
      .limit(1);
    if (!templateRevision) throw new DocumentNotFound();
    const content = checkedContent(fieldsOf(templateRevision), input);
    const [advanced] = await db
      .update(documents)
      .set({
        currentRevision: input.baseRevision + 1,
        status: content.validation.length ? "invalid" : "ready",
        updatedAt: new Date(),
      })
      .where(
        and(
          documentKey(scope, input.documentId),
          eq(documents.currentRevision, input.baseRevision),
        ),
      )
      .returning({ id: documents.id });
    if (!advanced) throw new DocumentRevisionConflict();
    const [revision] = await db
      .insert(documentRevisions)
      .values({
        tenantId: scope.tenantId,
        ownerUserId: scope.actorId,
        documentId: input.documentId,
        revision: input.baseRevision + 1,
        ...content,
      })
      .returning();
    if (!revision)
      throw new Error("Document revision insert did not return a row");
    await this.commitGenerationRequest(
      db,
      scope,
      input.requestIdentity,
      input.documentId,
      input.baseRevision + 1,
    );
    return revision;
  }

  async appendRevision(
    scope: DocumentScope,
    input: { documentId: string; baseRevision: number } & RevisionContent,
  ): Promise<DocumentRevisionRow> {
    return this.inScope(scope, (db) =>
      this.appendInTransaction(db, scope, input),
    );
  }

  async restoreRevision(
    scope: DocumentScope,
    input: { documentId: string; baseRevision: number; sourceRevision: number },
  ): Promise<DocumentRevisionRow> {
    return this.inScope(scope, async (db) => {
      const [source] = await db
        .select()
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.tenantId, scope.tenantId),
            eq(documentRevisions.ownerUserId, scope.actorId),
            eq(documentRevisions.documentId, input.documentId),
            eq(documentRevisions.revision, input.sourceRevision),
          ),
        )
        .limit(1);
      if (!source) throw new DocumentNotFound();
      return this.appendInTransaction(db, scope, {
        documentId: input.documentId,
        baseRevision: input.baseRevision,
        values: source.values as Record<string, string>,
        provenance: {
          ...(source.provenance as Record<string, unknown>),
          restoredFromRevision: input.sourceRevision,
          claimState: "unverified",
        },
        aiUsage: null,
      });
    });
  }

  async recordExport(
    scope: DocumentScope,
    input: {
      documentId: string;
      revision: number;
      format: DocumentFormat;
      title?: string;
      metadata?: Record<string, unknown>;
    } & (
      | { artifactId: string; bytes?: never }
      | { bytes: Uint8Array; artifactId?: never }
    ),
  ): Promise<DocumentExportRow> {
    return this.inScope(scope, async (db) => {
      const artifactId = input.bytes
        ? await this.createArtifact(
            db,
            scope,
            "interview.document-export",
            input.title ?? "Document",
            input.bytes,
            input.metadata,
          )
        : input.artifactId;
      const [row] = await db
        .insert(documentExports)
        .values({
          tenantId: scope.tenantId,
          ownerUserId: scope.actorId,
          documentId: input.documentId,
          revision: input.revision,
          format: input.format,
          artifactId,
        })
        .returning();
      if (!row) throw new Error("Document export insert did not return a row");
      return row;
    });
  }

  async listExports(
    scope: DocumentScope,
    documentId: string,
  ): Promise<DocumentExportRow[]> {
    return this.inScope(scope, (db) =>
      db
        .select()
        .from(documentExports)
        .where(
          and(
            eq(documentExports.tenantId, scope.tenantId),
            eq(documentExports.ownerUserId, scope.actorId),
            eq(documentExports.documentId, documentId),
          ),
        )
        .orderBy(desc(documentExports.createdAt)),
    );
  }

  async getExportArtifactId(
    scope: DocumentScope,
    exportId: string,
  ): Promise<string | null> {
    return this.inScope(scope, async (db) => {
      const [row] = await db
        .select({ artifactId: documentExports.artifactId })
        .from(documentExports)
        .where(
          and(
            eq(documentExports.tenantId, scope.tenantId),
            eq(documentExports.ownerUserId, scope.actorId),
            eq(documentExports.id, exportId),
          ),
        )
        .limit(1);
      return row?.artifactId ?? null;
    });
  }
}
