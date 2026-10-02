import { createPlatformApi } from "@omnitech/platform-api";
import { getPlatformDatabase } from "@omnitech/platform-storage";
import {
  briefingScope,
  createBriefingApi,
  loadLocalDefaultProfile,
  createInterviewApi,
} from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
import { Hono } from "hono";
import { createAgentApi } from "./agent-api";
import { createPlatformAiGateway } from "./ai";
import { resolvePlatformContext } from "./context";

const localDatabaseUrl =
  "postgresql://omnitech:omnitech@127.0.0.1:5432/omnitech";
if (process.env["NODE_ENV"] !== "production" && !process.env["DATABASE_URL"]) {
  process.env["DATABASE_URL"] = localDatabaseUrl;
}

export function createApplicationApi() {
  const api = new Hono();
  const ai =
    process.env["DATABASE_URL"] || process.env["NODE_ENV"] !== "production"
      ? createPlatformAiGateway()
      : undefined;
  api.route(
    "/",
    createPlatformApi({
      resolveContext: resolvePlatformContext,
      savePreferences: async (context, preferences) => {
        if (!process.env["DATABASE_URL"]) return;
        const { getPlatformDatabase, PlatformRepository } = await import(
          "@omnitech/platform-storage"
        );
        await new PlatformRepository(getPlatformDatabase()).savePreferences(
          context.user.id,
          preferences,
        );
      },
    }),
  );
  api.get("/api/platform/v1/ai-targets", async (request) => {
    const context = await resolvePlatformContext(
      request.req.query("tenant") ?? "",
    );
    if (!context) return request.json({ error: "Context not found." }, 404);
    if (!ai) return request.json({ error: "AI is not configured." }, 503);
    return request.json(
      await ai.listAvailableTargets({
        tenantId: context.tenant.id,
        userId: context.user.id,
        productId: "omnitech.platform",
        permissions: context.permissions,
      }),
    );
  });
  api.route("/", createInterviewApi());
  if (process.env["DATABASE_URL"] && ai) {
    const platformDatabase = getPlatformDatabase();
    api.route(
      "/",
      createBriefingApi({
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
            local?.tenantId === scope.tenantId
            ? loadLocalDefaultProfile()
            : null;
        },
        database: {
          tenantTransaction: (tenantId, fn) =>
            platformDatabase.tenantTransaction(tenantId, (tx) =>
              fn({
                query: async (sql, values) =>
                  (await tx.query(sql, values ? [...values] : undefined)).rows,
              }),
            ),
        },
        resolveScope: async (request) => {
          const tenant = new URL(request.url).searchParams.get("tenant") ?? "";
          return briefingScope(
            await resolvePlatformContext(tenant),
            tenant,
            request.method,
          );
        },
        generate: async (input, scope) => {
          const result = await ai.execute({
            context: {
              tenantId: scope.tenantId,
              userId: scope.actorId,
              productId: scope.productId,
              permissions: ["interview.read", "interview.write"],
            },
            profileId: "document-fast",
            task: { type: "structured-generation", ...input },
          });
          return result.result;
        },
      }),
    );
  }
  if (process.env["DATABASE_URL"] || process.env["NODE_ENV"] !== "production") {
    api.route("/api", createAgentApi());
    api.route(
      "/api",
      createPresentationApi({
        database: getPlatformDatabase(),
        resolveContext: resolvePlatformContext,
        ...(ai === undefined ? {} : { ai }),
      }),
    );
  }
  return api;
}
