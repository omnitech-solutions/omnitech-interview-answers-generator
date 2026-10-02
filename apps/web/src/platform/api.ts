import { createPlatformApi } from "@omnitech/platform-api";
import { getPlatformDatabase } from "@omnitech/platform-storage";
import { createInterviewApi } from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
import { Hono } from "hono";
import { createAgentApi } from "./agent-api";
import { createPlatformAiGateway } from "./ai";
import { resolvePlatformContext } from "./context";
import { getInterviewStudio } from "./interview-studio";

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
  // Interview Studio: the assistant, drafts, plan, briefs, briefing packs
  // and rehearsals, each scoped to the signed-in member of the tenant.
  if (process.env["DATABASE_URL"] && ai) {
    const forward = async (request: Request) =>
      (await getInterviewStudio(ai)).app.fetch(request);
    api.all("/api/assistant/*", (context) => forward(context.req.raw));
    api.all("/api/interview/*", (context) => forward(context.req.raw));
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
