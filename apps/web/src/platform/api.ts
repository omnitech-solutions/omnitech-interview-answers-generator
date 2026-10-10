import { createPlatformApi } from "@omnitech/platform-api";
import { Hono } from "hono";
import { createAgentApi } from "./agent-api";
import { createPlatformAiEngine } from "./ai";
import { apiErrorHandler, originGuard } from "./api-safety";
import { resolvePlatformContext } from "./context";
import { createProductBackends } from "./products";
import { platformRepository } from "./store";

export function createApplicationApi() {
  const api = new Hono();
  // Sub-apps with their own onError keep it; every other route gets this one.
  api.use("/api/*", originGuard);
  api.onError(apiErrorHandler);
  const engine = createPlatformAiEngine();
  api.route(
    "/",
    createPlatformApi({
      resolveContext: resolvePlatformContext,
      savePreferences: async (context, preferences) =>
        (await platformRepository()).savePreferences(
          context.user.id,
          preferences,
        ),
    }),
  );
  api.get("/api/platform/v1/ai-targets", async (request) => {
    const context = await resolvePlatformContext(
      request.req.query("tenant") ?? "",
    );
    if (!context) return request.json({ error: "Context not found." }, 404);
    // The member's permissions travel with the listing: the engine hands
    // this object to the host's authorisation as it is.
    const asking = {
      scope: {
        tenantId: context.tenant.id,
        actorId: context.user.id,
        productId: "omnitech.platform",
      },
      permissions: context.permissions,
    };
    // A catalogue's models are for a picker that asks for them, not here.
    return request.json(
      (await engine.profiles(asking)).filter((profile) => !profile.listing),
    );
  });
  // Each registered product's router, with the platform services it needs.
  for (const backend of createProductBackends(engine))
    api.route(backend.mountPath, backend.app as Hono);
  api.route("/api", createAgentApi());
  return api;
}
