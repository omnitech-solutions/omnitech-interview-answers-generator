import type {
  ProductFrontendPlugin,
  ProductManifest,
} from "@omnitech/platform-contracts";

export const manifest = {
  schemaVersion: 1,
  id: "omnitech.interview",
  version: "1.0.0",
  platformVersion: "^1.0.0",
  defaultName: "Interview",
  defaultDescription: "Create, practise, and organize interview material.",
  icon: "sparkles",
  permissions: ["interview.read", "interview.write"],
  routes: [
    {
      id: "interview.knowledge",
      defaultPath: "/knowledge",
      frontendEntry: "knowledge.page",
      requiredPermission: "interview.read",
    },
  ],
  navigation: [
    {
      routeId: "interview.knowledge",
      defaultLabel: "Knowledge",
      defaultDescription: "Browse reusable material",
      group: "Organize",
      order: 20,
    },
  ],
  configurationSchema: {},
} as const satisfies ProductManifest;

export const frontendPlugin: ProductFrontendPlugin = {
  id: manifest.id,
  routes: {
    "interview.knowledge": async () => {
      const { Library } = await import("./frontend/library.js");
      return { default: () => <Library /> };
    },
  },
};
