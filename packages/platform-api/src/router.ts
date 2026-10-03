import {
  type PlatformContext,
  type ProductFrontendPlugin,
  type ProductManifest,
  type ProductPageLoader,
  type ProductRouteManifest,
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

export interface RoutableProduct {
  manifest: ProductManifest;
  frontend: ProductFrontendPlugin;
}

export type ProductPageResolution =
  | { status: 404 }
  | {
      status: 200;
      context: PlatformContext;
      route: ProductRouteManifest;
      page: Awaited<ReturnType<ProductPageLoader>>["default"];
    };

/**
 * Resolves `/t/:tenantSlug/p/:productId/*` to the product page to render.
 * [SAFETY] (ADR-0004) Membership, then installation, then the route's
 * permission are checked before the product's loader runs; any miss is a 404
 * so no product code loads for someone who may not use it.
 */
export async function resolveProductPage(
  services: {
    resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
    products: readonly RoutableProduct[];
  },
  request: { tenantSlug: string; productId: string; path: readonly string[] },
): Promise<ProductPageResolution> {
  const notFound = { status: 404 } as const;
  // Membership first: a null context is a non-member (or signed out).
  const context = await services.resolveContext(request.tenantSlug);
  if (!context) return notFound;

  // The route segment is the product id or its last part ("interview").
  const product = services.products.find(
    ({ manifest }) =>
      manifest.id === request.productId ||
      manifest.id.split(".").at(-1) === request.productId,
  );
  const installation = context.products.find(
    (installed) => installed.productId === product?.manifest.id,
  );
  if (!product || !installation?.enabled) return notFound;

  // The manifest route the path names, which the member must be permitted.
  const requestedPath = `/${request.path.join("/")}`;
  const route = product.manifest.routes.find(
    (candidate) =>
      candidate.defaultPath === requestedPath ||
      requestedPath.startsWith(`${candidate.defaultPath}/`) ||
      installation.navigation.routes[candidate.id]?.path.endsWith(
        requestedPath,
      ),
  );
  if (!route || !context.permissions.includes(route.requiredPermission))
    return notFound;

  // Only now is product code loaded.
  const module = await product.frontend.routes[route.id]?.();
  if (!module) return notFound;
  return { status: 200, context, route, page: module.default };
}
