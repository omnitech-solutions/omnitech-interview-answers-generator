import {
  type PlatformContext,
  userPreferencesSchema,
} from "@omnitech/platform-contracts";
import { Hono } from "hono";

export interface PlatformApiServices {
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  savePreferences(
    context: PlatformContext,
    preferences: {
      theme: "system" | "light" | "dark";
      locale: string;
      aiProfileId?: string | null | undefined;
    },
  ): Promise<void>;
}

export function createPlatformApi(services: PlatformApiServices) {
  const api = new Hono();

  api.get("/api/platform/v1/context", async (request) => {
    const platformContext = await services.resolveContext(
      request.req.query("tenant") ?? "",
    );
    return platformContext
      ? request.json(platformContext)
      : request.json(
          {
            error: {
              code: "context_not_found",
              message: "Context not found.",
            },
          },
          404,
        );
  });

  api.get("/api/platform/v1/products", async (request) => {
    const platformContext = await services.resolveContext(
      request.req.query("tenant") ?? "",
    );
    return platformContext
      ? request.json({ items: platformContext.products })
      : request.json(
          {
            error: {
              code: "context_not_found",
              message: "Context not found.",
            },
          },
          404,
        );
  });

  api.put("/api/platform/v1/preferences", async (request) => {
    const platformContext = await services.resolveContext(
      request.req.query("tenant") ?? "",
    );
    if (!platformContext) {
      return request.json(
        {
          error: {
            code: "context_not_found",
            message: "Context not found.",
          },
        },
        404,
      );
    }
    const parsed = userPreferencesSchema.safeParse(await request.req.json());
    if (!parsed.success) {
      return request.json(
        {
          error: {
            code: "invalid_preferences",
            message: "Theme, locale, and a valid AI profile are required.",
          },
        },
        400,
      );
    }
    await services.savePreferences(platformContext, parsed.data);
    return request.json(parsed.data);
  });

  return api;
}
