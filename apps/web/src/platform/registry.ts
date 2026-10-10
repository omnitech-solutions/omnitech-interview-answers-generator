import type { ProductFrame } from "@omnitech/platform-contracts";
import { ProductRegistry } from "@omnitech/platform-runtime";
import {
  frontendPlugin as interviewFrontend,
  manifest as interviewManifest,
} from "@omnitech/product-interview/manifest";
import {
  frontendPlugin as presentationFrontend,
  manifest as presentationManifest,
} from "@omnitech/product-presentation/manifest";

// Build-time registration: every trusted product, its manifest and pages.
// Adding a product to the shell is a row here and a row in products.ts.
const REGISTERED_PRODUCTS: readonly Parameters<
  ProductRegistry["register"]
>[0][] = [
  { manifest: interviewManifest, frontend: interviewFrontend },
  { manifest: presentationManifest, frontend: presentationFrontend },
];

const registry = new ProductRegistry();
for (const product of REGISTERED_PRODUCTS) registry.register(product);

export function getProductRegistry(): ProductRegistry {
  return registry;
}

/**
 * Each product's frame, keyed by the route segments that name it (its id and
 * the id's last part), so the shell frames a page from registration data.
 */
export function productFrames(): Readonly<Record<string, ProductFrame>> {
  return Object.fromEntries(
    registry.list().flatMap(({ manifest }) => {
      const frame = manifest.frame ?? "standard";
      return [
        [manifest.id, frame],
        [manifest.id.split(".").at(-1) ?? manifest.id, frame],
      ];
    }),
  );
}
