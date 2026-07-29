import { createPlatformApi } from "@omnitech/platform-api";
import { createInterviewApi } from "@omnitech/product-interview/backend";
import { Hono } from "hono";

import { resolvePlatformContext } from "./context";

export function createApplicationApi() {
  const api = new Hono();
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
  api.route("/", createInterviewApi());
  return api;
}
