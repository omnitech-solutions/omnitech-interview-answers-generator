import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { createGatewayModelPort } from "@omnitech/ai-runtime";
import { DockerCodeRunner } from "@omnitech/code-runner";
import { getPlatformDatabase } from "@omnitech/platform-storage";
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
import { PgBossRunQueue } from "@omnitech-assistant/storage-postgres";
import { resolveDefaultLanguageModel } from "@omnitech/ai-sdk";
import { interviewAssistantBudget } from "./ai";
import { resolvePlatformContext } from "./context";

// The Studio sends the tenant of the page it runs on; briefing pack links
// may carry it as ?tenant= instead.
const TENANT_HEADER = "x-omnitech-tenant";
const PERMISSIONS = ["interview.read", "interview.write"] as const;

type InterviewStudio = ReturnType<typeof createInterviewStudio>;
declare global {
  // One studio per server process: the API route and the run worker share
  // it, and development reloads must not open a second queue.
  var interviewStudio: Promise<InterviewStudio> | undefined;
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
  const queue = new PgBossRunQueue({
    connectionString: process.env["DATABASE_URL"]!,
    supervise: false,
    schedule: false,
  });
  await queue.start();
  const language = (() => {
    try {
      return resolveDefaultLanguageModel();
    } catch {
      return null;
    }
  })();

  return createInterviewStudio({
    database: {
      tenantTransaction: (tenantId, fn) =>
        platform.tenantTransaction(tenantId, (client) => fn(rowsOf(client))),
    },
    workerDatabase: {
      transaction: (fn) =>
        platform.transaction(async (client) => {
          await client.query("SELECT set_config('app.run_worker', 'on', true)");
          return fn(rowsOf(client));
        }),
    },
    queue,
    // [SAFETY] Every request resolves the signed-in member of the named
    // tenant; writes also need interview.write.
    resolveScope: async (request) => {
      const slug =
        request.headers.get(TENANT_HEADER) ??
        new URL(request.url).searchParams.get("tenant") ??
        "";
      return briefingScope(
        await resolvePlatformContext(slug),
        slug,
        request.method,
      );
    },
    isMember: async (scope) => {
      const result = await platform.query(
        "SELECT 1 FROM platform.tenant_memberships WHERE tenant_id::text=$1 AND user_id::text=$2",
        [scope.tenantId, scope.actorId],
      );
      return result.rows.length > 0;
    },
    model: createGatewayModelPort(ai, async () => PERMISSIONS),
    modelVersion: `${language?.model ?? "local"}:plain-text-tools`,
    generate: async (input, scope: Scope) =>
      (
        await ai.execute({
          context: {
            tenantId: scope.tenantId,
            userId: scope.actorId,
            productId: scope.productId,
            permissions: [...PERMISSIONS],
          },
          profileId: INTERVIEW_ASSISTANT_PROFILE,
          task: { type: "structured-generation", ...input },
        })
      ).result,
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
  globalThis.interviewStudio ??= build(ai);
  return globalThis.interviewStudio;
}

// Runs queued assistant turns in this server process until it stops.
export async function runInterviewWorker(
  ai: AiExecutionGateway,
  signal: AbortSignal,
) {
  const { worker } = await getInterviewStudio(ai);
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
