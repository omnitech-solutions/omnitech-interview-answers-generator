import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { DockerCodeRunner } from "@omnitech/code-runner";
import type { PlatformDatabase } from "@omnitech/database";
import type { PlatformContext } from "@omnitech/platform-contracts";
import {
  type ModelRelay,
  productOperationFailure,
  type Scope,
  type Transaction,
} from "@omnitech-assistant/contracts";
import {
  PgBossRunQueue,
  PostgresModelRelay,
} from "@omnitech-assistant/storage-postgres";
import { Hono } from "hono";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_ASSISTANT_PROFILE,
} from "../assistant-profile";
import { manifest } from "../manifest";
import { createApi } from "./api";
import { createAssistantModels } from "./assistant-models";
import { BriefingRepository } from "./briefing/repository";
import { briefingScope } from "./briefing-access";
import { createDocumentsApi, resolveDocumentsScope } from "./documents/api";
import { resolveDocumentsConfig } from "./documents/config";
import { createSessionRoutes } from "./live-session/routes";
import { loadLocalDefaultProfile } from "./local-default-profile";
import { loadLocalTemplates, localMatrixPath } from "./local-seeds";
import { createInterviewStudio } from "./studio/host";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The platform services Interview Studio's backend runs on. */
export interface InterviewBackendServices {
  ai: AiExecutionGateway;
  database: PlatformDatabase;
  // The run queue's own connection (pg-boss opens it).
  runQueueConnectionString: string;
  // [SAFETY] The signed-in member's context for a tenant, or null.
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  // Whether a language model is configured; without one, generated answers
  // report 503 rather than drafting with the local placeholder.
  answersConfigured: boolean;
  // The version runs are recorded with, and the per-turn context budget.
  modelVersion: string;
  contextCharacters: number;
  // Offer the on-device (browser) model in the assistant's picker.
  onDeviceModel: boolean;
  // Preferred assistant picker model; unavailable targets use the product default.
  assistantDefaultModel?: string;
  // Local development: briefing packs start from the bundled profile.
  localDefaultProfile: boolean;
}

// The Studio sends the tenant of the page it runs on; briefing pack links
// may carry it as ?tenant= instead.
const TENANT_HEADER = "x-omnitech-tenant";

type InterviewStudio = ReturnType<typeof createInterviewStudio>;
declare global {
  // One run queue per server process: development reloads must not open a
  // second one.
  var interviewRunQueue: Promise<PgBossRunQueue> | undefined;
  // The current studio, shared by the API route and the run worker. It is
  // rebuilt when a reload re-runs this module (a new `build`).
  var interviewStudio:
    | {
        build: (services: InterviewBackendServices) => Promise<InterviewStudio>;
        studio: Promise<InterviewStudio>;
      }
    | undefined;
}

const rowsOf = (client: {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}): Transaction => ({
  query: async (sql, values) =>
    (await client.query(sql, values ? [...values] : undefined)).rows,
});

// [SAFETY] Every request resolves the signed-in member of the named tenant;
// writes also need interview.write.
function scopeResolver(services: InterviewBackendServices) {
  return async (request: Request) => {
    const slug =
      request.headers.get(TENANT_HEADER) ??
      new URL(request.url).searchParams.get("tenant") ??
      "";
    return briefingScope(
      await services.resolveContext(slug),
      slug,
      request.method,
    );
  };
}

// The product's one-shot JSON replies, on the given profile, as the member
// the request resolved to.
function generator(ai: AiExecutionGateway, profileId: string) {
  return async (input: { system: string; prompt: string }, scope: Scope) =>
    (
      await ai.execute({
        context: {
          tenantId: scope.tenantId,
          userId: scope.actorId,
          productId: scope.productId,
          permissions: [...manifest.permissions],
        },
        profileId,
        task: { type: "structured-generation", ...input },
      })
    ).result;
}

function workspaceDatabase(platform: PlatformDatabase) {
  return {
    tenantTransaction: <T>(
      tenantId: string,
      fn: (tx: Transaction) => Promise<T>,
    ) => platform.tenantTransaction(tenantId, (client) => fn(rowsOf(client))),
  };
}

async function build(
  services: InterviewBackendServices,
): Promise<InterviewStudio> {
  const platform = services.database;
  globalThis.interviewRunQueue ??= (async () => {
    const queue = new PgBossRunQueue({
      connectionString: services.runQueueConnectionString,
      supervise: false,
      schedule: false,
    });
    await queue.start();
    return queue;
  })();
  const queue = await globalThis.interviewRunQueue;

  const database = workspaceDatabase(platform);
  const relay: ModelRelay = new PostgresModelRelay(database);
  const assistantModels = createAssistantModels(
    services.ai,
    relay,
    services.onDeviceModel,
    services.assistantDefaultModel,
  );
  return createInterviewStudio({
    database,
    relay,
    workerDatabase: {
      transaction: (fn) =>
        platform.transaction(async (client) => {
          await client.query("SELECT set_config('app.run_worker', 'on', true)");
          return fn(rowsOf(client));
        }),
    },
    queue,
    resolveScope: scopeResolver(services),
    // Memberships are tenant-owned rows: read inside the scope's tenant.
    isMember: async (scope) => {
      if (!UUID.test(scope.tenantId)) return false;
      const result = await platform.tenantTransaction(
        scope.tenantId,
        (client) =>
          client.query(
            "SELECT 1 FROM platform.tenant_memberships WHERE tenant_id::text=$1 AND user_id::text=$2",
            [scope.tenantId, scope.actorId],
          ),
      );
      return result.rows.length > 0;
    },
    // The model a turn runs on is the one picked in the assistant.
    model: assistantModels.port,
    models: assistantModels.catalog,
    modelVersion: services.modelVersion,
    generate: generator(services.ai, INTERVIEW_ASSISTANT_PROFILE),
    runner: new DockerCodeRunner(),
    contextCharacters: services.contextCharacters,
    // Local development starts briefing packs from the bundled profile, for
    // the local member only.
    loadDefaultProfile: async (scope) =>
      (await isLocalMember(services, scope)) ? loadLocalProfile() : null,
  });
}

// [SAFETY] Local development seeds the dev member only: never another member
// of the tenant, and never in production.
async function isLocalMember(
  services: InterviewBackendServices,
  scope: { tenantId: string; actorId: string },
): Promise<boolean> {
  if (!services.localDefaultProfile) return false;
  const local = briefingScope(
    await services.resolveContext("local"),
    "local",
    "POST",
  );
  return local?.actorId === scope.actorId && local.tenantId === scope.tenantId;
}

async function loadLocalProfile() {
  const path = await localMatrixPath();
  return loadLocalDefaultProfile(path ? { path } : {});
}

function studioOf(services: InterviewBackendServices) {
  if (globalThis.interviewStudio?.build !== build)
    globalThis.interviewStudio = { build, studio: build(services) };
  return globalThis.interviewStudio.studio;
}

/**
 * Interview Studio's backend as the platform mounts it: one Hono app for the
 * answers API, the assistant and the studio's own APIs, and the worker that
 * runs queued assistant turns in the server process.
 */
export function createInterviewBackend(services: InterviewBackendServices) {
  const resolveScope = scopeResolver(services);
  // Read once, so a bad setting stops startup instead of the first document.
  const documentsConfig = resolveDocumentsConfig();
  const app = new Hono();
  // Active Session ingest, stream and control (ADR-0011): mounted first so the
  // studio's /api/interview/* catch-all never sees them.
  app.route(
    "/",
    createSessionRoutes({
      database: services.database,
      resolveContext: services.resolveContext,
    }),
  );
  // Interview answers and explanations, generated on the gateway for the
  // member of the tenant the request names.
  app.route(
    "/",
    createApi({
      resolveScope,
      // [SAFETY] HO-SEC-02: the browser UI is accepted only as a verified
      // member of the tenant its request names (the header is a lookup key;
      // the session cookie is the proof). No tenant, no session.
      verifySession: async (request) => {
        const slug =
          request.headers.get(TENANT_HEADER) ??
          new URL(request.url).searchParams.get("tenant") ??
          "";
        return slug !== "" && (await services.resolveContext(slug)) !== null;
      },
      ...(services.answersConfigured
        ? { generate: generator(services.ai, INTERVIEW_ANSWER_PROFILE) }
        : {}),
    }),
  );
  // Candidate documents have their own member write permission and persist
  // through the product's private repository and platform artifact boundary.
  const profiles = new BriefingRepository(workspaceDatabase(services.database));
  app.route(
    "/",
    createDocumentsApi({
      database: services.database,
      ai: services.ai,
      config: documentsConfig,
      localTemplates: async (scope) =>
        (await isLocalMember(services, scope)) ? loadLocalTemplates() : null,
      ensureProfile: async (scope) => {
        if (!(await isLocalMember(services, scope))) return;
        const input = await loadLocalProfile();
        if (input) await profiles.syncDefaultProfile(scope, input);
      },
      resolveScope: async (request) => {
        const slug =
          request.headers.get(TENANT_HEADER) ??
          new URL(request.url).searchParams.get("tenant") ??
          "";
        return resolveDocumentsScope(
          await services.resolveContext(slug),
          slug,
          request.method,
        );
      },
    }),
  );
  // The assistant, drafts, plan, briefs, briefing packs and rehearsals,
  // each scoped to the signed-in member of the tenant.
  const forward = async (request: Request) =>
    (await studioOf(services)).app.fetch(request);
  app.all("/api/assistant/*", (context) => forward(context.req.raw));
  app.all("/api/interview/*", (context) => forward(context.req.raw));

  // Runs queued assistant turns in this server process until it stops.
  async function runWorker(signal: AbortSignal) {
    await studioOf(services);
    // [STRATEGY] The worker starts with the server and is never reloaded, so
    // each tick takes the current studio rather than keeping the first one:
    // after a reload, turns run on the product code the API route now uses.
    const current = () =>
      globalThis.interviewStudio?.studio ?? studioOf(services);
    // Polls every 200 ms while idle; after a failure it waits 5 s, so a
    // persistent fault never spins.
    const idle = (ms = 200) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    while (!signal.aborted) {
      try {
        const { worker } = await current();
        if (!(await worker.tick(signal))) await idle();
      } catch (error) {
        // A failed turn is recorded on its run; the worker reports only the
        // failure's code (never content) and carries on.
        if (signal.aborted) break;
        console.error(
          JSON.stringify({
            interviewWorker:
              productOperationFailure(error)?.code ??
              (error instanceof Error ? error.name : "worker-failed"),
          }),
        );
        await idle(5000);
      }
    }
  }

  return { app, runWorker };
}
