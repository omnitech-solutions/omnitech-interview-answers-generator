import type { AiEngine, JsonSchema } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import type { PlatformContext } from "@omnitech/platform-contracts";
import {
  type ModelInfo,
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
import { promptMessages } from "./ai-messages";
import { createApi } from "./api";
import { createAssistantModels } from "./assistant-models";
import { BriefingRepository } from "./briefing/repository";
import { briefingScope } from "./briefing-access";
import { coachTranscript, speakerOfSource } from "./coach-transcript";
import { createDocumentsApi, resolveDocumentsScope } from "./documents/api";
import { resolveDocumentsConfig } from "./documents/config";
import { createSessionRoutes } from "./live-session/routes";
import { loadLocalDefaultProfile } from "./local-default-profile";
import { loadLocalTemplates, localMatrixPath } from "./local-seeds";
import { createCodeRunner } from "./services";
import { createInterviewStudio } from "./studio/host";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The platform services Interview Studio's backend runs on. */
export interface InterviewBackendServices {
  engine: AiEngine;
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
  // Preferred assistant picker model; an unavailable one falls back to the product default.
  assistantDefaultModel?: string;
  // How the picker presents the assistant's own profile. Absent: the profile
  // is not offered (the host has no language model behind it).
  assistantListing?: Omit<ModelInfo, "id">;
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

// The product's one-shot structured replies, on the given profile, as the
// member the request resolved to. The reply's schema goes to the engine, which
// asks the provider for that shape, checks the answer against it and makes one
// repair turn when it misses (ADR-0037).
function generator(engine: AiEngine, profileId: string) {
  return async (
    {
      schema,
      system,
      prompt,
    }: { system: string; prompt: string; schema: Record<string, unknown> },
    scope: Scope,
  ) => {
    const generated = await engine.generate(
      {
        profileId,
        messages: promptMessages(system, prompt),
        schema: schema as JsonSchema,
      },
      {
        scope,
        permissions: [...manifest.permissions],
        signal: new AbortController().signal,
      },
    );
    // The failure's code only: its detail can carry provider text.
    if (!generated.ok)
      throw new Error(`Generation failed: ${generated.failure.code}`);
    return generated.value;
  };
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
    services.engine,
    relay,
    services.onDeviceModel,
    services.assistantListing,
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
    // [DOMAIN] The pack's one-shot generation (drafted answers, the prepared
    // briefing, condensing the setup) runs where the assistant runs: on the
    // agent (Claude Code) when that is the default model, otherwise on the
    // assistant's own profile.
    generate: generator(
      services.engine,
      services.assistantDefaultModel?.startsWith("agent/")
        ? services.assistantDefaultModel
        : INTERVIEW_ASSISTANT_PROFILE,
    ),
    runner: createCodeRunner(),
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
      // What a session hears is the coach's input, as it arrives.
      onHeard: (heard) =>
        coachTranscript.add(
          [
            {
              speaker: speakerOfSource(heard.source),
              text: heard.text,
              at: heard.occurredAt,
            },
          ],
          heard.session,
        ),
    }),
  );
  // Interview answers and explanations, generated on the engine for the
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
        ? { generate: generator(services.engine, INTERVIEW_ANSWER_PROFILE) }
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
      engine: services.engine,
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
