import type {
  ProductFrontendPlugin,
  ProductInstallationConfiguration,
  ProductManifest,
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
}
