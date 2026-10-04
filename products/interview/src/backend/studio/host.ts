import { createHash } from "node:crypto";
import type { CodeRunner } from "@omnitech/code-runner";
import {
  type DatabasePort,
  type ModelCatalog,
  type ModelPort,
  type ModelRelay,
  originSchema,
  productOperationFailure,
  type Scope,
  type Transaction,
} from "@omnitech-assistant/contracts";
import {
  ApiError,
  type CoreDependencies,
  createAssistantApp,
  createAssistantWorker,
  createAttachmentService,
} from "@omnitech-assistant/server";
import {
  type PgBossRunQueue,
  RunRepository,
} from "@omnitech-assistant/storage-postgres";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  INTERVIEW_ASSISTANT_PROFILE,
  INTERVIEW_PRODUCT_ID,
} from "../../assistant-profile.js";
import {
  createInterviewAdapter,
  interviewPatchJsonSchema,
} from "../assistant/adapter.js";
import { interviewRunVersions } from "../assistant/prompt.js";
import {
  InterviewWorkspaceRepository,
  interviewDraftPatchSchema,
} from "../assistant/workspace.js";
import { createBriefingApi } from "../briefing/api.js";
import { createBriefsApi } from "../briefs/api.js";
import { createPlanApi } from "../plan/api.js";
import { createRehearsalApi, rehearsalStatus } from "../rehearsal/api.js";

const NEW_QUESTION = "New interview question";
// The Workspace id prefix of a session-owned draft (live-session/session-drafts.ts).
const SESSION_WORKSPACE_PREFIX = "active-session:";

type StructuredInput = {
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
};

export type InterviewStudioOptions = {
  // Tenant transactions (app.tenant_id set) for product data and runs.
  database: DatabasePort;
  // Unscoped transactions for the run queue and worker leases.
  workerDatabase: {
    transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  };
  queue: PgBossRunQueue;
  // [SAFETY] The host authenticates the session and resolves the tenant
  // membership; null refuses the request before any domain work.
  resolveScope(request: Request): Promise<Scope | null>;
  // Membership for work that runs outside a request (the run worker).
  isMember(scope: Scope): Promise<boolean>;
  // The assistant's streaming model, and the version runs are recorded with.
  model: ModelPort;
  modelVersion: string;
  // The models a person may pick for the assistant; `model` must run each one.
  // Without it, only the built-in assistant profile is offered.
  models?: ModelCatalog;
  // Hands on-device model calls to the person's browser; required when the
  // catalog offers a model that runs there.
  relay?: ModelRelay;
  // One-shot structured generation for briefs and briefing packs.
  generate(input: StructuredInput, scope: Scope): Promise<unknown>;
  runner: Pick<CodeRunner, "runAll">;
  // How much conversation and draft the model is given each turn.
  contextCharacters: number;
  // The candidate profile a new briefing pack starts from, if any.
  loadDefaultProfile?: (
    scope: Scope,
  ) => Promise<{ name: string; matrix: unknown } | null>;
};

// Interview Studio's server: the docked assistant, Workspace drafts, the
// prep plan, briefs, briefing packs and rehearsals, all private to the
// signed-in member. The host mounts `app` and runs `worker` in its process.
export function createInterviewStudio(options: InterviewStudioOptions) {
  const { database } = options;
  const workspace = new InterviewWorkspaceRepository(database);

  // [DOMAIN] Evidence is used only by its audience and never once restricted;
  // a technical reference is trusted when its text still matches its hash.
  const product = createInterviewAdapter(database, {
    runner: options.runner,
    authorizeEvidence: async (scope, item) =>
      item.audience.includes(scope.actorId) &&
      item.classification !== "restricted",
    verifyTechnicalReference: async (_scope, item) =>
      createHash("sha256").update(item.text).digest("hex") === item.sha256,
  });

  // [SAFETY] Revocation: a restricted latest source in this private
  // workspace denies derived drafts, saved versions, history and context.
  async function readable(scope: Scope) {
    if (scope.productId !== INTERVIEW_PRODUCT_ID) return false;
    const rows = await workspace.transaction(scope, (tx) =>
      tx.query(
        "SELECT classification,audience FROM (SELECT DISTINCT ON(id) id,classification,audience FROM interview.assistant_evidence WHERE tenant_id=$1 AND actor_id=$2 AND product_id=$3 ORDER BY id,revision DESC) latest",
        [scope.tenantId, scope.actorId, scope.productId],
      ),
    );
    return rows.every(
      (row) =>
        row["classification"] !== "restricted" &&
        Array.isArray(row["audience"]) &&
        row["audience"].includes(scope.actorId),
    );
  }

  const core: CoreDependencies = {
    database,
    repository: new RunRepository(
      database,
      options.workerDatabase,
      options.queue,
      interviewRunVersions(options.modelVersion),
    ),
    model: options.model,
    ...(options.models ? { models: options.models } : {}),
    products: new Map([[INTERVIEW_PRODUCT_ID, product]]),
    patchSchemas: new Map([[INTERVIEW_PRODUCT_ID, interviewPatchJsonSchema]]),
    authority: {
      isMember: async (scope) =>
        scope.productId === INTERVIEW_PRODUCT_ID &&
        (await options.isMember(scope)),
      hasPermissions: readable,
      // [SAFETY] A run may use the built-in profile or a model the catalog
      // currently offers this person, never an arbitrary id.
      authorizeProfile: async (scope, id) =>
        (id === INTERVIEW_ASSISTANT_PROFILE ||
          Boolean(
            (await options.models?.list(scope))?.models.some(
              (model) => model.id === id,
            ),
          )) &&
        (await readable(scope)),
    },
  };
  const attachments = createAttachmentService(core, {
    async ingest(tx, scope, input) {
      const evidence = {
        id: input.id,
        revision: 1,
        sha256: input.sha256,
        text: input.text,
        locator: `attachment://${input.id}`,
        classification: "confidential" as const,
        audience: [scope.actorId],
        sourceKind: "candidate" as const,
      };
      await workspace.putEvidenceTransaction(tx, scope, evidence);
      return evidence;
    },
    async resolve(tx, scope, id) {
      const item = await workspace.readEvidenceTransaction(tx, scope, id, 1);
      if (
        item.classification === "restricted" ||
        !item.audience.includes(scope.actorId)
      )
        throw new ApiError("evidence-forbidden", 403);
      return item;
    },
  });
  core.resolveAttachmentEvidence = (scope, ids, origin) =>
    attachments.resolve(scope, ids, origin);

  // Every route resolves the member first; product APIs reuse that scope.
  const scopeOf = async (request: Request) => {
    const scope = await options.resolveScope(request);
    return scope && (await readable(scope)) ? scope : null;
  };

  const app = new Hono<{ Variables: { scope: Scope } }>();
  app.onError((error, context) => {
    const failure = productOperationFailure(error);
    if (error instanceof z.ZodError)
      return context.json({ code: "invalid-request" }, 400);
    return context.json(
      {
        code:
          failure?.code ??
          (error instanceof ApiError ? error.code : "internal-error"),
        message: failure?.code ?? "operation-failed",
      },
      (failure?.statusCode ??
        (error instanceof ApiError ? error.status : 500)) as 400,
    );
  });

  // The assistant package serves its own routes below /api/assistant.
  const assistant = createAssistantApp({
    ...core,
    ...(options.relay ? { relay: options.relay } : {}),
    attachments,
    resolveScope: scopeOf,
  });
  app.all("/api/assistant/*", (context) => {
    const request = context.req.raw;
    // Frameworks may canonicalize the URL's host; Host keeps the browser's,
    // which the assistant's same-origin check compares with Origin.
    const url = new URL(request.url);
    url.host = request.headers.get("host") ?? url.host;
    url.pathname = url.pathname.slice("/api/assistant".length);
    return assistant.fetch(
      new Request(url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        ...(["GET", "HEAD"].includes(request.method)
          ? {}
          : { body: request.body, duplex: "half" }),
      } as RequestInit),
    );
  });

  const generate = async (input: StructuredInput, scope: Scope) =>
    options.generate(input, scope);
  const mount = (prefix: string, api: { fetch(request: Request): unknown }) => {
    app.all(prefix, (context) => api.fetch(context.req.raw) as Response);
    app.all(`${prefix}/*`, (context) => api.fetch(context.req.raw) as Response);
  };
  mount(
    "/api/interview/plan",
    createPlanApi({
      database,
      questionsWorkspace: "interview",
      rehearsalStatus: rehearsalStatus(database),
      resolveScope: scopeOf,
    }),
  );
  mount(
    "/api/interview/briefs",
    createBriefsApi({ database, resolveScope: scopeOf, generate }),
  );
  mount(
    "/api/interview/rehearsals",
    createRehearsalApi({ database, resolveScope: scopeOf }),
  );
  mount(
    "/api/interview/briefing",
    createBriefingApi({
      database,
      resolveScope: scopeOf,
      generate,
      loadDefaultProfile: async (scope) =>
        (await options.loadDefaultProfile?.(scope)) ?? null,
    }),
  );

  // Workspace drafts: the canonical record each Workspace question edits.
  const drafts = new Hono<{ Variables: { scope: Scope } }>();
  drafts.use("*", async (context, next) => {
    const scope = await scopeOf(context.req.raw);
    if (!scope) throw new ApiError("unauthorized", 401);
    context.set("scope", scope);
    await next();
  });
  const path = "/:workspace/artifacts/:artifact";
  const originFor = (context: Context) =>
    originSchema.parse({
      workspaceId: context.req.param("workspace"),
      artifactId: context.req.param("artifact"),
      artifactRevision: 0,
    });
  const bound = (
    context: Context,
    origin: { workspaceId: string; artifactId: string },
  ) => {
    const route = originFor(context);
    if (
      origin.workspaceId !== route.workspaceId ||
      origin.artifactId !== route.artifactId
    )
      throw new ApiError("origin-conflict", 409);
  };
  const editSchema = z.strictObject({
    origin: originSchema,
    patch: interviewDraftPatchSchema,
  });
  const effectSchema = z.strictObject({
    origin: originSchema,
    requestId: z.string().min(1).max(256),
  });

  drafts.get("/:workspace/artifacts", async (context) =>
    context.json(
      await workspace.listDrafts(
        context.get("scope"),
        context.req.param("workspace"),
      ),
    ),
  );
  // Reading a question that does not exist yet starts it.
  drafts.get(path, async (context) => {
    const scope = context.get("scope");
    const origin = originFor(context);
    try {
      return context.json(
        await workspace.read(scope, origin.workspaceId, origin.artifactId),
      );
    } catch (error) {
      if (productOperationFailure(error)?.code !== "not-found") throw error;
      // [GUARD] A session's Workspace is written only by the session, inside
      // its publish transaction. A placeholder made by opening it would make
      // that publish see "a draft this session never wrote" and refuse it
      // (session-drafts.ts), so a missing one is simply not found.
      if (origin.workspaceId.startsWith(SESSION_WORKSPACE_PREFIX)) throw error;
      return context.json(
        await workspace.create(scope, origin, {
          question: NEW_QUESTION,
          notes: "",
        }),
      );
    }
  });
  drafts.patch(path, async (context) => {
    const input = editSchema.parse(await context.req.json());
    bound(context, input.origin);
    return context.json(
      await workspace.edit(context.get("scope"), input.origin, input.patch),
    );
  });
  drafts.post(`${path}/save`, async (context) => {
    const input = effectSchema.parse(await context.req.json());
    bound(context, input.origin);
    return context.json(
      await workspace.save(context.get("scope"), input.origin, input.requestId),
    );
  });
  drafts.post(`${path}/run-code`, async (context) => {
    const scope = context.get("scope");
    const input = effectSchema.parse(await context.req.json());
    bound(context, input.origin);
    // [GUARD] Tests run in Docker; say so plainly when it is not running.
    const result = await product
      .runCode(scope, input, context.req.raw.signal)
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message === "Docker daemon is unavailable."
        )
          throw new ApiError("runner-unavailable", 503);
        throw error;
      });
    const effect = await workspace.transaction(scope, (tx) =>
      workspace.readEffectTransaction(tx, scope, "run-code", input.requestId),
    );
    return context.json({ ...result, ...(effect?.result as object) });
  });
  // Saved versions of one question, newest first.
  drafts.get(`${path}/versions`, async (context) => {
    const origin = originFor(context);
    const records = await workspace.listAnswerRevisions(
      context.get("scope"),
      origin.workspaceId,
      origin.artifactId,
    );
    return context.json(
      records.map((record) => ({
        ...record.value.answer,
        question: record.value.question,
        notes: record.value.notes,
        id: `${origin.artifactId}:${record.savedRevision}`,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      })),
    );
  });
  app.route("/api/interview/workspaces", drafts);

  const worker = createAssistantWorker({
    ...core,
    budgets: { maxContextCharacters: options.contextCharacters },
  });
  return { app, worker };
}
