import { createPlatformApi } from "@omnitech/platform-api";
import { Hono } from "hono";
import { createAgentApi } from "./agent-api";
import { createPlatformAiGateway } from "./ai";
import { apiErrorHandler, originGuard } from "./api-safety";
import { resolvePlatformContext } from "./context";
import { createProductBackends } from "./products";

export function createApplicationApi() {
  const api = new Hono();
  // Sub-apps with their own onError keep it; every other route gets this one.
  api.use("/api/*", originGuard);
  api.onError(apiErrorHandler);
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
  // Each registered product's router, with the platform services it needs.
  for (const backend of createProductBackends(ai))
    api.route(backend.mountPath, backend.app as Hono);
  api.route("/api", createAgentApi());
  return api;
}
