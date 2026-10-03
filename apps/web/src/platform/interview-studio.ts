import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { DockerCodeRunner } from "@omnitech/code-runner";
import { getPlatformDatabase } from "@omnitech/database";
import {
  briefingScope,
  createInterviewStudio,
  INTERVIEW_ASSISTANT_PROFILE,
  loadLocalDefaultProfile,
} from "@omnitech/product-interview/backend";
import {
  productOperationFailure,
  type Scope,
  type Transaction,
} from "@omnitech-assistant/contracts";
import {
  PgBossRunQueue,
  PostgresModelRelay,
} from "@omnitech-assistant/storage-postgres";
import { interviewAssistantBudget } from "./ai";
import { resolveDefaultLanguageModel } from "./ai-config";
import { createAssistantModels } from "./assistant-models";
import { resolvePlatformContext } from "./context";

// The Studio sends the tenant of the page it runs on; briefing pack links
// may carry it as ?tenant= instead.
const TENANT_HEADER = "x-omnitech-tenant";
const PERMISSIONS = ["interview.read", "interview.write"] as const;

// [SAFETY] Every request resolves the signed-in member of the named tenant;
// writes also need interview.write.
export async function resolveInterviewScope(request: Request) {
  const slug =
    request.headers.get(TENANT_HEADER) ??
    new URL(request.url).searchParams.get("tenant") ??
    "";
  return briefingScope(
    await resolvePlatformContext(slug),
    slug,
    request.method,
  );
}

// The product's one-shot JSON replies, on the given profile, as the member the
// request resolved to.
export function interviewGenerate(
  ai: AiExecutionGateway,
  profileId: string = INTERVIEW_ASSISTANT_PROFILE,
) {
  return async (input: { system: string; prompt: string }, scope: Scope) =>
    (
      await ai.execute({
        context: {
          tenantId: scope.tenantId,
          userId: scope.actorId,
          productId: scope.productId,
          permissions: [...PERMISSIONS],
        },
        profileId,
        task: { type: "structured-generation", ...input },
      })
    ).result;
}

type InterviewStudio = ReturnType<typeof createInterviewStudio>;
declare global {
  // One run queue per server process: development reloads must not open a
  // second one.
  var interviewRunQueue: Promise<PgBossRunQueue> | undefined;
  // The current studio, shared by the API route and the run worker. It is
  // rebuilt when a reload re-runs this module (a new `build`), which happens
  // whenever this file, the product or anything else it imports changes.
  var interviewStudio:
    | {
        build: (ai: AiExecutionGateway) => Promise<InterviewStudio>;
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

async function build(ai: AiExecutionGateway): Promise<InterviewStudio> {
  const platform = getPlatformDatabase();
  globalThis.interviewRunQueue ??= (async () => {
    const queue = new PgBossRunQueue({
      connectionString: process.env["DATABASE_URL"]!,
      supervise: false,
      schedule: false,
    });
    await queue.start();
    return queue;
  })();
  const queue = await globalThis.interviewRunQueue;
  const language = resolveDefaultLanguageModel();

  const database = {
    tenantTransaction: <T>(
      tenantId: string,
      fn: (tx: Transaction) => Promise<T>,
    ) => platform.tenantTransaction(tenantId, (client) => fn(rowsOf(client))),
  };
  const relay = new PostgresModelRelay(database);
  // The on-device model is offered only when a model is pinned; the panel
  // hides it in browsers without WebGPU.
  const assistantModels = createAssistantModels(
    ai,
    relay,
    Boolean(process.env["NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256"]),
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
    resolveScope: resolveInterviewScope,
    isMember: async (scope) => {
      const result = await platform.query(
        "SELECT 1 FROM platform.tenant_memberships WHERE tenant_id::text=$1 AND user_id::text=$2",
        [scope.tenantId, scope.actorId],
      );
      return result.rows.length > 0;
    },
    // The model a turn runs on is the one picked in the assistant.
    model: assistantModels.port,
    models: assistantModels.catalog,
    modelVersion: `${language?.model ?? "local"}:plain-text-tools`,
    generate: interviewGenerate(ai),
    runner: new DockerCodeRunner(),
    contextCharacters: interviewAssistantBudget(language?.baseUrl)
      .contextCharacters,
    // Local development starts briefing packs from the bundled profile.
    loadDefaultProfile: async (scope) => {
      if (
        process.env["NODE_ENV"] === "production" ||
        process.env["FAKE_AUTH_ENABLED"] !== "true"
      )
        return null;
      const local = briefingScope(
        await resolvePlatformContext("local"),
        "local",
        "POST",
      );
      return local?.actorId === scope.actorId &&
        local.tenantId === scope.tenantId
        ? loadLocalDefaultProfile()
        : null;
    },
  });
}

export function getInterviewStudio(ai: AiExecutionGateway) {
  if (globalThis.interviewStudio?.build !== build)
    globalThis.interviewStudio = { build, studio: build(ai) };
  return globalThis.interviewStudio.studio;
}

// Runs queued assistant turns in this server process until it stops.
export async function runInterviewWorker(
  ai: AiExecutionGateway,
  signal: AbortSignal,
) {
  await getInterviewStudio(ai);
  // [STRATEGY] The worker starts with the server and is never reloaded, so
  // each tick takes the current studio rather than keeping the first one:
  // after a reload, turns run on the product code the API route now uses.
  const current = () =>
    globalThis.interviewStudio?.studio ?? getInterviewStudio(ai);
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
