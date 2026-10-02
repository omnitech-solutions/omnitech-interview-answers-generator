import type { ProductManifest } from "@omnitech/platform-contracts";

const STUDIO_VIEWS = [
  { id: "home", path: "/" },
  { id: "work", path: "/work" },
  { id: "briefings", path: "/briefings" },
  { id: "knowledge", path: "/knowledge" },
  { id: "rehearsal", path: "/rehearsal" },
] as const;

export const manifest = {
  schemaVersion: 1,
  id: "omnitech.interview",
  version: "1.0.0",
  platformVersion: "^1.0.0",
  defaultName: "Interview",
  defaultDescription: "Create, practise, and organize interview material.",
  icon: "sparkles",
  permissions: ["interview.read", "interview.write"],
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
