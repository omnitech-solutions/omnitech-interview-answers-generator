import type { InstalledProductSummary } from "@omnitech/platform-contracts";
import { manifest as interviewManifest } from "@omnitech/product-interview/manifest";

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
        path: "/p/interview/workspace",
        hidden: false,
      },
      "interview.knowledge": {
        label: "Knowledge",
        description: "Browse reusable material",
        path: "/p/interview/knowledge",
        hidden: false,
      },
    },
  },
  featureFlags: {},
  settings: {},
  revision: 1,
};
