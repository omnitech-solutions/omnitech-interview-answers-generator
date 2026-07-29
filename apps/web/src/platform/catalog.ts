import type {
  InstalledProductSummary,
  ProductManifest,
} from "@omnitech/platform-contracts";

export const interviewManifest = {
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
      id: "interview.workspace",
      defaultPath: "/workspace",
      frontendEntry: "workspace.page",
      requiredPermission: "interview.read",
    },
    {
      id: "interview.knowledge",
      defaultPath: "/knowledge",
      frontendEntry: "knowledge.page",
      requiredPermission: "interview.read",
    },
  ],
  navigation: [
    {
      routeId: "interview.workspace",
      defaultLabel: "Workspace",
      defaultDescription: "Create and refine material",
      group: "Create",
      order: 10,
    },
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

export const localInterviewInstallation: InstalledProductSummary = {
  productId: interviewManifest.id,
  name: "Interview",
  description: interviewManifest.defaultDescription,
  icon: interviewManifest.icon,
  enabled: true,
  routePrefix: "",
  navigation: {
    group: "Products",
    order: 10,
    hidden: false,
    routes: {
      "interview.workspace": {
        label: "Workspace",
        description: "Create and refine material",
        path: "/workspace",
        hidden: false,
      },
      "interview.knowledge": {
        label: "Knowledge",
        description: "Browse reusable material",
        path: "/knowledge",
        hidden: false,
      },
    },
  },
  featureFlags: {},
  settings: {},
  revision: 1,
};
