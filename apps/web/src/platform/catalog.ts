import type { InstalledProductSummary } from "@omnitech/platform-contracts";
import { manifest as interviewManifest } from "@omnitech/product-interview/manifest";
import { manifest as presentationManifest } from "@omnitech/product-presentation/manifest";

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

export const localPresentationInstallation: InstalledProductSummary = {
  productId: presentationManifest.id,
  name: "Presentations",
  description: presentationManifest.defaultDescription,
  icon: presentationManifest.icon,
  enabled: true,
  routePrefix: "/p/presentation",
  navigation: {
    group: "Products",
    order: 20,
    hidden: false,
    routes: {
      "presentation.library": {
        label: "Presentations",
        description: "Browse and manage visual documents",
        path: "/p/presentation/library",
        hidden: false,
      },
      "presentation.create": {
        label: "Create",
        description: "Start a presentation",
        path: "/p/presentation/create",
        hidden: false,
      },
      "presentation.themes": {
        label: "Themes",
        description: "Manage visual systems",
        path: "/p/presentation/themes",
        hidden: false,
      },
      "presentation.image-studio": {
        label: "Image Studio",
        description: "Generate and manage images",
        path: "/p/presentation/images",
        hidden: false,
      },
    },
  },
  featureFlags: {
    sharing: true,
    recording: true,
    exports: true,
    imageStudio: true,
  },
  settings: {},
  revision: 1,
};
