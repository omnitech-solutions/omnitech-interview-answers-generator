import { ProductRegistry } from "@omnitech/platform-runtime";
import {
  frontendPlugin as interviewFrontend,
  manifest as interviewManifest,
} from "@omnitech/product-interview/manifest";
import {
  frontendPlugin as presentationFrontend,
  manifest as presentationManifest,
} from "@omnitech/product-presentation/manifest";

const registry = new ProductRegistry();
registry.register({
  manifest: interviewManifest,
  frontend: interviewFrontend,
});
registry.register({
  manifest: presentationManifest,
  frontend: presentationFrontend,
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
