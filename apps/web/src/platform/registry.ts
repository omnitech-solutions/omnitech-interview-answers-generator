import { ProductRegistry } from "@omnitech/platform-runtime";
import { manifest as interviewManifest } from "@omnitech/product-interview/manifest";
import {
  frontendPlugin as presentationFrontend,
  manifest as presentationManifest,
} from "@omnitech/product-presentation/manifest";
import { InterviewStudioPage } from "./interview-studio-page";

const registry = new ProductRegistry();
// Every interview route is the client-only Interview Studio page.
registry.register({
  manifest: interviewManifest,
  frontend: {
    id: interviewManifest.id,
    routes: Object.fromEntries(
      interviewManifest.routes.map((route) => [
        route.id,
        async () => ({ default: InterviewStudioPage }),
      ]),
    ),
  },
});
registry.register({
  manifest: presentationManifest,
  frontend: presentationFrontend,
});

export function getProductRegistry(): ProductRegistry {
  return registry;
}
