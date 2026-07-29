import { createPlatformApi } from "@omnitech/platform-api";
import { getPlatformDatabase } from "@omnitech/platform-storage";
import { createInterviewApi } from "@omnitech/product-interview/backend";
import { createPresentationApi } from "@omnitech/product-presentation/backend";
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
  if (process.env["DATABASE_URL"]) {
    api.route(
      "/",
      createPresentationApi({
        database: getPlatformDatabase(),
        resolveContext: resolvePlatformContext,
      }),
    );
  }
  return api;
}
