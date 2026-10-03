import { createPlatformApi } from "@omnitech/platform-api";
import { getPlatformDatabase } from "@omnitech/database";
import {
  createInterviewApi,
  INTERVIEW_ANSWER_PROFILE,
} from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
import { Hono } from "hono";
import { createAgentApi } from "./agent-api";
import { createPlatformAiGateway } from "./ai";
import { resolveDefaultLanguageModel } from "./ai-config";
import { resolvePlatformContext } from "./context";
import {
  getInterviewStudio,
  interviewGenerate,
  resolveInterviewScope,
} from "./interview-studio";

export function createApplicationApi() {
  const api = new Hono();
  const ai = createPlatformAiGateway();
  api.route(
    "/",
    createPlatformApi({
      resolveContext: resolvePlatformContext,
      savePreferences: async (context, preferences) => {
        const [{ getPlatformDatabase }, { PlatformRepository }] =
          await Promise.all([
            import("@omnitech/database"),
            import("@omnitech/platform-storage"),
          ]);
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
    return request.json(
      await ai.listAvailableTargets({
        tenantId: context.tenant.id,
        userId: context.user.id,
        productId: "omnitech.platform",
        permissions: context.permissions,
      }),
    );
  });
  // Interview answers and explanations: generated on the gateway for the
  // member of the tenant the request names; without a configured model the
  // API answers 503 instead of drafting with the local placeholder.
  api.route(
    "/",
    createInterviewApi({
      resolveScope: resolveInterviewScope,
      ...(resolveDefaultLanguageModel()
        ? { generate: interviewGenerate(ai, INTERVIEW_ANSWER_PROFILE) }
        : {}),
    }),
  );
  // Interview Studio: the assistant, drafts, plan, briefs, briefing packs
  // and rehearsals, each scoped to the signed-in member of the tenant.
  const forward = async (request: Request) =>
    (await getInterviewStudio(ai)).app.fetch(request);
  api.all("/api/assistant/*", (context) => forward(context.req.raw));
  api.all("/api/interview/*", (context) => forward(context.req.raw));
  api.route("/api", createAgentApi());
  api.route(
    "/api",
    createPresentationApi({
      database: getPlatformDatabase(),
      resolveContext: resolvePlatformContext,
      ai,
    }),
  );
  return api;
}
