import type {
  ProductFrontendPlugin,
  ProductManifest,
} from "@omnitech/platform-contracts";

const STUDIO_VIEWS = [
  { id: "home", path: "/" },
  { id: "work", path: "/work" },
  { id: "briefings", path: "/briefings" },
  { id: "documents", path: "/documents" },
  { id: "knowledge", path: "/knowledge" },
  { id: "rehearsal", path: "/rehearsal" },
  { id: "live", path: "/live" },
] as const;

export const manifest = {
  schemaVersion: 1,
  id: "omnitech.interview",
  version: "1.0.0",
  platformVersion: "^1.0.0",
  defaultName: "Interview",
  defaultDescription: "Create, practise, and organize interview material.",
  icon: "sparkles",
  // The studio fills the viewport below the platform header.
  frame: "fill-viewport",
  permissions: [
    "interview.read",
    "interview.write",
    "interview.documents.write",
  ],
  // Interview Studio routes within itself; each top-level view is a route
  // here so the platform authorizes and serves it. Every route renders the
  // studio's single entry point, StudioPage (see ./frontend).
  routes: STUDIO_VIEWS.map((view) => ({
    id: `interview.${view.id}`,
    defaultPath: view.path,
    frontendEntry: "studio.page",
    requiredPermission: "interview.read",
  })),
  navigation: [
    {
      routeId: "interview.home",
      defaultLabel: "Interview Studio",
      defaultDescription: "Prepare, practise and rehearse interviews",
      group: "Create",
      order: 10,
    },
  ],
  configurationSchema: {},
} as const satisfies ProductManifest;

// Every interview route loads the client-only studio entry.
export const frontendPlugin: ProductFrontendPlugin = {
  id: manifest.id,
  routes: Object.fromEntries(
    manifest.routes.map((route) => [
      route.id,
      async () => {
        const { StudioRoute } = await import("./frontend/studio-route");
        return { default: StudioRoute };
      },
    ]),
  ),
};
