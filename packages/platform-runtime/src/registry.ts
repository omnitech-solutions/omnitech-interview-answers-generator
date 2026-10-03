import type {
  PlatformContext,
  ProductFrontendPlugin,
  ProductInstallationConfiguration,
  ProductLink,
  ProductManifest,
  ProductPageLoader,
  ProductRouteManifest,
} from "@omnitech/platform-contracts";

export class DuplicateProductError extends Error {
  constructor(readonly productId: string) {
    super(`Product "${productId}" is registered more than once.`);
    this.name = "DuplicateProductError";
  }
}

export class DuplicateRouteError extends Error {
  constructor(readonly routeId: string) {
    super(`Route "${routeId}" is registered more than once.`);
    this.name = "DuplicateRouteError";
  }
}

export class ProductUnavailableError extends Error {
  constructor(readonly productId: string) {
    super(`Product "${productId}" is unavailable.`);
    this.name = "ProductUnavailableError";
  }
}

export interface RegisteredProduct {
  manifest: ProductManifest;
  frontend: ProductFrontendPlugin;
}

export interface ResolvedProductRoute {
  productId: string;
  routeId: string;
  path: string;
  requiredPermission: string;
}

export type ProductPageResolution =
  | { status: 404 }
  | {
      status: 200;
      context: PlatformContext;
      route: ProductRouteManifest;
      page: Awaited<ReturnType<ProductPageLoader>>["default"];
      products: readonly ProductLink[];
    };

export class ProductRegistry {
  private readonly products = new Map<string, RegisteredProduct>();
  private readonly routeOwners = new Map<string, string>();

  register(product: RegisteredProduct): void {
    if (this.products.has(product.manifest.id)) {
      throw new DuplicateProductError(product.manifest.id);
    }
    if (product.frontend.id !== product.manifest.id) {
      throw new TypeError("Frontend plugin id must match its manifest id.");
    }
    const manifestRouteIds = new Set<string>();
    for (const route of product.manifest.routes) {
      if (manifestRouteIds.has(route.id)) {
        throw new DuplicateRouteError(route.id);
      }
      manifestRouteIds.add(route.id);
      if (this.routeOwners.has(route.id)) {
        throw new DuplicateRouteError(route.id);
      }
      if (!product.frontend.routes[route.id]) {
        throw new TypeError(`Route "${route.id}" has no frontend loader.`);
      }
    }
    for (const route of product.manifest.routes) {
      this.routeOwners.set(route.id, product.manifest.id);
    }
    this.products.set(product.manifest.id, product);
  }

  list(): readonly RegisteredProduct[] {
    return [...this.products.values()];
  }

  get(productId: string): RegisteredProduct {
    const product = this.products.get(productId);
    if (!product) throw new ProductUnavailableError(productId);
    return product;
  }

  resolveRoutes(
    productId: string,
    installation: ProductInstallationConfiguration,
  ): readonly ResolvedProductRoute[] {
    if (!installation.enabled) throw new ProductUnavailableError(productId);
    const product = this.get(productId);
    return product.manifest.routes.map((route) => {
      const configured = installation.navigation.routes[route.id];
      return {
        productId,
        routeId: route.id,
        path:
          configured?.path ?? `${installation.routePrefix}${route.defaultPath}`,
        requiredPermission: route.requiredPermission,
      };
    });
  }

  /**
   * Resolves `/t/:tenantSlug/p/:productId/*` to the product page to render.
   * [SAFETY] (ADR-0004, INV-0004) Membership, then installation, then the
   * route's permission are checked before the product's loader runs; any miss
   * is a 404 so no product code loads for someone who may not use it.
   */
  async resolvePage(
    resolveContext: (tenantSlug: string) => Promise<PlatformContext | null>,
    request: { tenantSlug: string; productId: string; path: readonly string[] },
  ): Promise<ProductPageResolution> {
    const notFound = { status: 404 } as const;
    // Membership first: a null context is a non-member (or signed out).
    const context = await resolveContext(request.tenantSlug);
    if (!context) return notFound;

    // The route segment is the product id or its last part ("interview").
    const product = this.list().find(
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
    // The products the member can switch to: enabled, not hidden, in the
    // tenant's navigation order.
    const products = context.products
      .filter((installed) => installed.enabled && !installed.navigation.hidden)
      .sort((a, b) => a.navigation.order - b.navigation.order)
      .map((installed) => ({
        productId: installed.productId,
        name: installed.name,
        icon: installed.icon,
        href: `/t/${encodeURIComponent(request.tenantSlug)}${installed.routePrefix}`,
        current: installed.productId === product.manifest.id,
      }));
    return { status: 200, context, route, page: module.default, products };
  }
}
