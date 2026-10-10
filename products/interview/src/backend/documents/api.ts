import { createHash } from "node:crypto";
import type { AiEngine } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import {
  documentCreateSchema,
  documentEditSchema,
  documentExportSchema,
  documentRegenerateSchema,
  documentTemplateCreateSchema,
  documentValuesSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { DocumentArtifactRepository } from "@omnitech/platform-storage";
import { Hono } from "hono";
import { ZodError, z } from "zod";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { registerBriefRoutes } from "../brief/routes";
import type { ApplicationPacks } from "../context-pack/application";
import {
  type PackRoutesOptions,
  registerPackRoutes,
} from "../context-pack/routes";
import { createInFlight, linkedAbort, ndjsonResponse } from "../work-guards";
import type { BuiltInKey } from "./built-in-templates";
import {
  addCandidacyInterview,
  createCandidacy,
  readOwnedCandidacy,
  updateCandidacyContext,
  updateJobDescription,
} from "./candidacy.repository";
import {
  type CandidacyDeps,
  candidacyContextOf,
  documentSources,
  writeEmployerBrief,
} from "./candidacy.service";
import { DEFAULT_DOCUMENTS_CONFIG, type DocumentsConfig } from "./config";
import {
  type ContactDetails,
  DocumentContextNotFound,
  resolveDocumentContext,
} from "./context";
import {
  type Asking,
  confirmDocument,
  createDocument,
  type DocumentDeps,
  type DocumentScope,
  DocumentSourceChanged,
  DocumentVerificationFailed,
  writers as documentWriters,
  exportDocument,
  GenerationFailed,
  InvalidField,
  listExports,
  previewDraft,
  previewRevision,
  RequestCancelled,
  readExport,
  refreshSources,
  regenerateDocument,
  requireDocument,
  restoreRevision,
  saveRevision,
  swapCast,
  TargetUnavailable,
  viewDocument,
  type WriteOutcome,
} from "./document.service";
import {
  DocumentNotFound,
  DocumentRetryConflict,
  DocumentRevisionConflict,
  DocumentSaveCancelled,
  InterviewDocumentRepository,
} from "./repository";
import {
  createTemplate,
  duplicateTemplate,
  inspectedFields,
  listTemplates,
  previewTemplate,
  readOwnTemplate,
  readTemplate,
  reviseInstructions,
  reviseTemplate,
  type TemplateDeps,
} from "./template.service";
import { InvalidDocumentTemplateError } from "./template-intake";

export type { DocumentScope } from "./document.service";

const prefix = "/api/interview/documents";
const uuid = z.uuid();
const positive = z.coerce.number().int().positive();
const MAX_JSON = 128 * 1024;
const MAX_UPLOAD = 5 * 1024 * 1024;
const retryKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const retryKeyOf = (request: Request) => {
  const value = request.headers.get("idempotency-key");
  return value === null ? null : retryKeySchema.parse(value);
};
const bindingHash = (parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
class RequestTooLarge extends Error {}
export function resolveDocumentsScope(
  context: PlatformContext | null,
  slug: string,
  method: string,
): DocumentScope | null {
  if (
    !context ||
    context.tenant.slug !== slug ||
    context.membership.tenantId !== context.tenant.id ||
    context.membership.userId !== context.user.id ||
    !context.products.some(
      (product) =>
        product.productId === INTERVIEW_PRODUCT_ID && product.enabled,
    ) ||
    !context.permissions.includes("interview.read") ||
    (!["GET", "HEAD"].includes(method) &&
      !context.permissions.includes("interview.documents.write"))
  )
    return null;
  return {
    tenantId: context.tenant.id,
    actorId: context.user.id,
    productId: INTERVIEW_PRODUCT_ID,
    canWrite: context.permissions.includes("interview.documents.write"),
  };
}
const scopeKey = (scope: DocumentScope) => ({
  tenantId: scope.tenantId,
  actorId: scope.actorId,
});
async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new RequestTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new RequestTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request: Request): Promise<unknown> {
  return JSON.parse((await boundedBody(request, MAX_JSON)).toString("utf8"));
}
async function upload(request: Request) {
  const body = await boundedBody(request, MAX_UPLOAD + MAX_JSON);
  const bounded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: new Uint8Array(body),
  });
  const form = await bounded.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new SyntaxError("Missing file");
  if (file.size === 0 || file.size > MAX_UPLOAD) throw new RequestTooLarge();
  return { form, bytes: Buffer.from(await file.arrayBuffer()) };
}
function formText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string") throw new SyntaxError(`Missing ${key}`);
  return value;
}
function safeName(title: string, format: string) {
  return `${
    title
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .trim()
      .slice(0, 100) || "document"
  }.${format}`;
}

const interviewInput = z.strictObject({
  kind: z.enum([
    "recruiter_screen",
    "hiring_manager",
    "technical",
    "system_design",
    "take_home",
    "panel",
    "final",
    "other",
  ]),
  label: z.string().trim().min(1).max(120),
});

export function createDocumentsApi(options: {
  database: PlatformDatabase;
  engine: AiEngine;
  resolveScope: (request: Request) => Promise<DocumentScope | null>;
  // Local development: the author's own template files and experience
  // matrix, for the local member only.
  localTemplates?: (
    scope: DocumentScope,
  ) => Promise<Partial<Record<BuiltInKey, Buffer>> | null>;
  ensureProfile?: (scope: DocumentScope) => Promise<void>;
  // The local member's contact details, kept on this machine (never in git
  // or the matrix), for the documents' contact fields.
  localContact?: (scope: DocumentScope) => Promise<ContactDetails | null>;
  // How documents are written; defaults suit a long template.
  config?: DocumentsConfig;
  // Where the Studio's own transcript recordings are, for attaching one to
  // an interview stage. Absent: none are offered.
  recordingsDirectory?: string;
  // The context pack of an application (context-pack/routes.ts): where the
  // engine keeps prepared packs, the profile a preparation reads with, and
  // the member's experience matrix.
  packs?: PackRoutesOptions["packs"];
  packProfile?: PackRoutesOptions["packProfile"];
  loadMatrix?: PackRoutesOptions["loadMatrix"];
  // What a writing call is given of the application's prepared pack (the
  // employer's requirements with the evidence for each, and the cast roles'
  // achievements whole). Absent, or with no pack prepared: a document is
  // written from the matrix alone, as before.
  applicationPacks?: Pick<ApplicationPacks, "forDocument">;
}) {
  const config = options.config ?? DEFAULT_DOCUMENTS_CONFIG;
  const app = new Hono<{ Variables: { documentScope: DocumentScope } }>();
  const repo = new InterviewDocumentRepository(options.database);
  const artifacts = new DocumentArtifactRepository(options.database);
  const templates: TemplateDeps = {
    repo,
    artifacts,
    config,
    localTemplates: options.localTemplates,
    builtInReady: new Map(),
  };
  const candidacies: CandidacyDeps = {
    database: options.database,
    engine: options.engine,
  };
  app.use(`${prefix}/*`, async (c, next) => {
    const scope = await options.resolveScope(c.req.raw);
    if (!scope) return c.json({ error: { code: "unauthorized" } }, 401);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const host = c.req.header("host");
      const own = host
        ? new URL(`${new URL(c.req.url).protocol}//${host}`).origin
        : new URL(c.req.url).origin;
      if (
        c.req.header("sec-fetch-site") === "cross-site" ||
        (origin && origin !== own)
      )
        return c.json({ error: { code: "origin-forbidden" } }, 403);
    }
    c.set("documentScope", scope);
    await next();
  });
  app.onError((error, c) => {
    if (
      error instanceof DocumentNotFound ||
      error instanceof DocumentContextNotFound
    )
      return c.json({ error: { code: "not-found" } }, 404);
    if (error instanceof DocumentRevisionConflict)
      return c.json({ error: { code: "revision-conflict" } }, 409);
    if (error instanceof DocumentRetryConflict)
      return c.json({ error: { code: "retry-key-conflict" } }, 409);
    if (error instanceof DocumentSourceChanged)
      return c.json({ error: { code: "source-refresh-required" } }, 409);
    if (error instanceof DocumentVerificationFailed)
      return c.json(
        { error: { code: "verification-failed", fields: error.fields } },
        409,
      );
    if (error instanceof RequestTooLarge)
      return c.json({ error: { code: "body-too-large" } }, 413);
    if (error instanceof TargetUnavailable)
      return c.json({ error: { code: "generation-unavailable" } }, 503);
    if (error instanceof GenerationFailed)
      return c.json({ error: { code: "generation-failed" } }, 502);
    if (
      error instanceof RequestCancelled ||
      error instanceof DocumentSaveCancelled
    )
      return c.json({ error: { code: "cancelled" } }, 409);
    // The template's refusal reason is fixed text (never the file's own content),
    // so it is safe to show and is what says which template check failed.
    if (error instanceof InvalidDocumentTemplateError)
      return c.json(
        {
          error: {
            code: "invalid-field-or-template",
            reason: error.message,
          },
        },
        400,
      );
    if (error instanceof InvalidField)
      return c.json({ error: { code: "invalid-field-or-template" } }, 400);
    if (error instanceof ZodError)
      return c.json({ error: { code: "invalid-request" } }, 400);
    if (error instanceof SyntaxError)
      return c.json({ error: { code: "invalid-request" } }, 400);
    throw error;
  });
  // The interview brief (stages, transcripts, employer-said, research) of an
  // application: behind the same guard, in its own module (brief/routes.ts).
  registerBriefRoutes(app, {
    database: options.database,
    prefix,
    recordingsDirectory: options.recordingsDirectory,
  });
  // The application's context pack: its review, its preparation by a model
  // and its corrections, behind the same guard (context-pack/routes.ts).
  registerPackRoutes(app, {
    database: options.database,
    prefix,
    engine: options.engine,
    packs: options.packs,
    packProfile: options.packProfile,
    loadMatrix: options.loadMatrix,
  });
  // What the use cases are given (document.service.ts).
  const deps: DocumentDeps = {
    repo,
    artifacts,
    engine: options.engine,
    config,
    writing: createInFlight(),
    applicationPacks: options.applicationPacks,
    async contextFor(scope, input) {
      const contact =
        (await options.localContact?.(scope).catch(() => null)) ?? null;
      return resolveDocumentContext(options.database, input, { contact });
    },
  };
  const writers = (scope: DocumentScope) => documentWriters(deps, scope);
  // What a model call is told of the request that asked for it.
  const askingOf = (request: Request, binding: unknown[]): Asking => ({
    headers: request.headers,
    signal: request.signal,
    retryKey: retryKeyOf(request),
    bindingHash: bindingHash(binding),
  });
  const inProgress = { inProgress: true, offer: "wait" } as const;
  app.get(`${prefix}/context`, async (c) => {
    const scope = c.get("documentScope");
    // A fresh local member starts with their own experience matrix.
    await options.ensureProfile?.(scope).catch(() => undefined);
    const [lists, targets] = await Promise.all([
      documentSources(candidacies, scope),
      scope.canWrite === false ? Promise.resolve([]) : writers(scope),
    ]);
    return c.json({
      ...lists,
      // The browser tells an agent from a model by `kind`, as the engine lists it.
      targets: targets.map(({ id, label, kind }) => ({ id, label, kind })),
    });
  });
  app.patch(`${prefix}/candidacies/:id/job-description`, async (c) => {
    const scope = c.get("documentScope");
    const id = uuid.parse(c.req.param("id"));
    const { jobDescription } = z
      .object({ jobDescription: z.string().max(20_000) })
      .parse(await jsonBody(c.req.raw));
    const saved = await updateJobDescription(
      options.database,
      scope,
      id,
      jobDescription,
    );
    if (!saved) throw new DocumentContextNotFound();
    return c.json({ jobDescription: saved["job_description"] });
  });
  app.get(`${prefix}/candidacies/:id/context`, async (c) => {
    const scope = c.get("documentScope");
    const id = uuid.parse(c.req.param("id"));
    return c.json(
      candidacyContextOf(await readOwnedCandidacy(options.database, scope, id)),
    );
  });
  app.patch(`${prefix}/candidacies/:id/context`, async (c) => {
    const scope = c.get("documentScope");
    const id = uuid.parse(c.req.param("id"));
    const input = z
      .strictObject({
        title: z.string().trim().min(1).max(200).optional(),
        jobDescription: z.string().max(20_000).optional(),
        notes: z.string().max(20_000).optional(),
      })
      .parse(await jsonBody(c.req.raw));
    const row = await updateCandidacyContext(
      options.database,
      scope,
      id,
      input,
    );
    return c.json(candidacyContextOf(row));
  });
  app.post(`${prefix}/candidacies/:id/brief`, async (c) =>
    c.json(
      await writeEmployerBrief(
        candidacies,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
        c.req.raw,
      ),
    ),
  );
  // An application the person is working on, and optionally its first
  // interview stage, so documents have something to be written for.
  app.post(`${prefix}/candidacies`, async (c) => {
    const scope = c.get("documentScope");
    const input = z
      .strictObject({
        companyName: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        jobDescription: z.string().max(20_000).optional(),
        interview: interviewInput.optional(),
      })
      .parse(await jsonBody(c.req.raw));
    const created = await createCandidacy(options.database, scope, input);
    return c.json(created, 201);
  });
  app.post(`${prefix}/candidacies/:id/interviews`, async (c) => {
    const scope = c.get("documentScope");
    const candidacyId = uuid.parse(c.req.param("id"));
    const input = interviewInput.parse(await jsonBody(c.req.raw));
    const interviewId = await addCandidacyInterview(
      options.database,
      scope,
      candidacyId,
      input,
    );
    if (!interviewId) throw new DocumentContextNotFound();
    return c.json({ interviewId }, 201);
  });
  app.get(`${prefix}/templates`, async (c) =>
    c.json({
      templates: await listTemplates(templates, c.get("documentScope")),
    }),
  );
  app.get(`${prefix}/templates/:id`, async (c) => {
    const selected = c.req.query("revision");
    return c.json(
      await readTemplate(
        templates,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
        selected ? positive.parse(selected) : undefined,
      ),
    );
  });
  app.post(`${prefix}/templates/intake`, async (c) => {
    const { form, bytes } = await upload(c.req.raw);
    const format = z.enum(["docx", "md"]).parse(formText(form, "format"));
    return c.json({ fields: await inspectedFields(format, bytes) });
  });
  app.post(`${prefix}/templates`, async (c) => {
    const { form, bytes } = await upload(c.req.raw);
    const metadata = documentTemplateCreateSchema.parse({
      name: formText(form, "name"),
      kind: formText(form, "kind"),
      format: formText(form, "format"),
      instructions: formText(form, "instructions"),
    });
    return c.json(
      await createTemplate(templates, c.get("documentScope"), {
        ...metadata,
        bytes,
        reviewed: form.get("fields"),
      }),
      201,
    );
  });
  app.post(`${prefix}/templates/:id/revisions`, async (c) => {
    const scope = c.get("documentScope");
    // Whose template it is comes before what the request carries.
    const existing = await readOwnTemplate(
      templates,
      scope,
      uuid.parse(c.req.param("id")),
    );
    const { form, bytes } = await upload(c.req.raw);
    const expectedRevision = positive.parse(formText(form, "expectedRevision"));
    const instructions = z
      .string()
      .max(16_000)
      .parse(formText(form, "instructions"));
    return c.json(
      await reviseTemplate(templates, scope, existing, {
        expectedRevision,
        instructions,
        bytes,
        reviewed: form.get("fields"),
      }),
      201,
    );
  });
  app.post(`${prefix}/templates/:id/preview`, async (c) => {
    const input = z
      .strictObject({ revision: positive, values: documentValuesSchema })
      .parse(await jsonBody(c.req.raw));
    return c.json(
      await previewTemplate(
        templates,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
        input,
      ),
    );
  });
  app.post(`${prefix}/templates/:id/instructions`, async (c) => {
    const scope = c.get("documentScope");
    const existing = await readOwnTemplate(
      templates,
      scope,
      uuid.parse(c.req.param("id")),
    );
    const input = z
      .strictObject({
        expectedRevision: positive,
        instructions: z.string().max(16_000),
      })
      .parse(await jsonBody(c.req.raw));
    return c.json(
      await reviseInstructions(templates, scope, existing, input),
      201,
    );
  });
  app.post(`${prefix}/templates/:id/duplicate`, async (c) => {
    const scope = c.get("documentScope");
    const original = await readTemplate(
      templates,
      scope,
      uuid.parse(c.req.param("id")),
    );
    const { name } = z
      .strictObject({ name: z.string().trim().min(1).max(200) })
      .parse(await jsonBody(c.req.raw));
    return c.json(
      await duplicateTemplate(templates, scope, original, name),
      201,
    );
  });
  app.get(prefix, async (c) =>
    c.json({
      documents: await repo.listDocuments(scopeKey(c.get("documentScope"))),
    }),
  );
  app.post(prefix, async (c) => {
    const scope = c.get("documentScope");
    const input = documentCreateSchema.parse(await jsonBody(c.req.raw));
    // The work ends with the request, or with the reader of its stream.
    const { signal, readerGone } = linkedAbort(c.req.raw.signal);
    const outcome = await createDocument(deps, scope, input, {
      ...askingOf(c.req.raw, ["create", scope.tenantId, scope.actorId, input]),
      signal,
    });
    const exists = (existingDocumentId: string) =>
      c.json({ existingDocumentId, offer: "open-it" }, 409);
    if (outcome.kind === "replayed")
      return c.json(
        {
          document: outcome.document,
          revision: outcome.revision,
          replayed: true,
        },
        200,
      );
    if (outcome.kind === "exists") return exists(outcome.existingDocumentId);
    if (outcome.kind === "created")
      return c.json({ ...outcome.created, errors: outcome.errors }, 201);
    if (outcome.kind === "in-progress") return c.json(inProgress, 409);
    if (!(c.req.header("accept") ?? "").includes("application/x-ndjson")) {
      try {
        const created = await outcome.write();
        if ("existingDocumentId" in created)
          return exists(created.existingDocumentId as string);
        return c.json({ ...created, errors: created.revision.validation }, 201);
      } finally {
        outcome.release();
      }
    }
    // A person watching a document being written sees each section as it is
    // done: the plan first, then a line per section, then the saved document.
    return ndjsonResponse(
      async (send) => {
        try {
          const created = await outcome.write({
            onPlan: (plan) => send({ t: "plan", ...plan }),
            onBatch: (update) => send({ t: "batch", ...update }),
          });
          send(
            "existingDocumentId" in created
              ? { t: "exists", existingDocumentId: created.existingDocumentId }
              : {
                  t: "done",
                  document: created.document,
                  errors: created.revision.validation,
                },
          );
        } catch (error) {
          send({
            t: "error",
            code:
              error instanceof RequestCancelled ||
              error instanceof DocumentSaveCancelled
                ? "cancelled"
                : error instanceof GenerationFailed
                  ? "generation-failed"
                  : "server-error",
          });
        }
      },
      { onReaderGone: readerGone, onSettled: outcome.release },
    );
  });
  app.get(`${prefix}/:id`, async (c) => {
    const selected = c.req.query("revision");
    return c.json(
      await viewDocument(
        deps,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
        selected ? positive.parse(selected) : undefined,
      ),
    );
  });
  app.post(`${prefix}/:id/revisions`, async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = documentEditSchema.parse(await jsonBody(c.req.raw));
    return c.json(
      await saveRevision(deps, c.get("documentScope"), id, input),
      201,
    );
  });
  // A model's write: saved, replayed for a repeated retry key, or refused
  // because another window is writing the same revision.
  const written = (outcome: WriteOutcome) =>
    outcome.kind === "in-progress"
      ? Response.json(inProgress, { status: 409 })
      : outcome.kind === "replayed"
        ? Response.json({ ...outcome.revision, replayed: true })
        : Response.json(outcome.revision, { status: 201 });
  app.post(`${prefix}/:id/regenerate`, async (c) => {
    const scope = c.get("documentScope");
    const id = uuid.parse(c.req.param("id"));
    const input = z
      .union([
        documentRegenerateSchema.extend({
          aiTargetId: z.string().min(1).max(256),
        }),
        z.strictObject({
          baseRevision: z.number().int().positive(),
          mode: z.enum(["all", "fix"]),
          aiTargetId: z.string().min(1).max(256),
        }),
      ])
      .parse(await jsonBody(c.req.raw));
    return written(
      await regenerateDocument(
        deps,
        scope,
        id,
        input,
        askingOf(c.req.raw, [
          "regenerate",
          scope.tenantId,
          scope.actorId,
          id,
          input,
        ]),
      ),
    );
  });
  app.post(`${prefix}/:id/cast`, async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = z
      .strictObject({
        baseRevision: z.number().int().positive(),
        block: z.string().min(1).max(40),
        roleId: z.string().regex(/^\/roles\/\d+$/),
        aiTargetId: z.string().min(1).max(256),
      })
      .parse(await jsonBody(c.req.raw));
    return written(
      await swapCast(deps, c.get("documentScope"), id, input, {
        headers: c.req.raw.headers,
        signal: c.req.raw.signal,
      }),
    );
  });
  const baseRevisionInput = z.strictObject({
    baseRevision: z.number().int().positive(),
  });
  app.post(`${prefix}/:id/refresh-sources`, async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = baseRevisionInput.parse(await jsonBody(c.req.raw));
    return c.json(
      await refreshSources(deps, c.get("documentScope"), id, input),
      201,
    );
  });
  app.post(`${prefix}/:id/confirm`, async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = baseRevisionInput.parse(await jsonBody(c.req.raw));
    return c.json(
      await confirmDocument(deps, c.get("documentScope"), id, input),
      201,
    );
  });
  app.post(`${prefix}/:id/restore`, async (c) => {
    const scope = c.get("documentScope");
    const id = uuid.parse(c.req.param("id"));
    // Whose document it is comes before what the request says.
    await requireDocument(deps, scope, id);
    const input = z
      .strictObject({
        baseRevision: z.number().int().positive(),
        sourceRevision: z.number().int().positive(),
      })
      .parse(await jsonBody(c.req.raw));
    return c.json(await restoreRevision(deps, scope, id, input), 201);
  });
  app.get(`${prefix}/:id/preview`, async (c) => {
    const selected = c.req.query("revision");
    return c.json(
      await previewRevision(
        deps,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
        selected ? positive.parse(selected) : undefined,
      ),
    );
  });
  app.post(`${prefix}/:id/preview`, async (c) => {
    const input = documentEditSchema.parse(await jsonBody(c.req.raw));
    return c.json(
      await previewDraft(
        deps,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
        input,
      ),
    );
  });
  app.post(`${prefix}/:id/exports`, async (c) => {
    const id = uuid.parse(c.req.param("id"));
    const input = documentExportSchema.parse(await jsonBody(c.req.raw));
    const outcome = await exportDocument(
      deps,
      c.get("documentScope"),
      id,
      input,
    );
    return outcome.kind === "unsupported-format"
      ? c.json({ error: { code: "unsupported-format" } }, 400)
      : c.json(outcome.export, 201);
  });
  app.get(`${prefix}/:id/exports`, async (c) =>
    c.json({
      exports: await listExports(
        deps,
        c.get("documentScope"),
        uuid.parse(c.req.param("id")),
      ),
    }),
  );
  app.get(`${prefix}/:id/exports/:exportId/download`, async (c) => {
    const id = uuid.parse(c.req.param("id"));
    // The document is found before the export's id is read.
    await requireDocument(deps, c.get("documentScope"), id);
    const record = await readExport(
      deps,
      c.get("documentScope"),
      id,
      uuid.parse(c.req.param("exportId")),
    );
    c.header(
      "content-type",
      record.format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/markdown; charset=utf-8",
    );
    c.header(
      "content-disposition",
      `attachment; filename="${safeName(record.title, record.format)}"`,
    );
    c.header("x-content-type-options", "nosniff");
    return c.body(new Uint8Array(record.bytes));
  });
  return app;
}
