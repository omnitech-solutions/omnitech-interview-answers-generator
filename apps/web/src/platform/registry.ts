import { ProductRegistry } from "@omnitech/platform-runtime";
import {
  frontendPlugin as interviewFrontend,
  manifest as interviewManifest,
} from "@omnitech/product-interview/manifest";

const registry = new ProductRegistry();
registry.register({
  manifest: interviewManifest,
  frontend: interviewFrontend,
});

export function getProductRegistry(): ProductRegistry {
  return registry;
}

export function resolveProductId(routeProductId: string): string | null {
  return (
    registry
      .list()
      .find(
        ({ manifest }) =>
          manifest.id === routeProductId ||
          manifest.id.split(".").at(-1) === routeProductId,
      )?.manifest.id ?? null
  );
}
