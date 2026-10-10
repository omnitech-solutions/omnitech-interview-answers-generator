// The products a bootstrapped tenant starts with, as data: what the tenant's
// installation row says and the configuration the shell reads from it. The
// bootstrap script beside this file writes one row per entry.
export interface BootstrapInstallation {
  productId: string;
  displayName: string;
  description: string;
  icon: string;
  sortOrder: number;
  configuration: Record<string, unknown>;
}

export const BOOTSTRAP_INSTALLATIONS: readonly BootstrapInstallation[] = [
  {
    productId: "omnitech.presentation",
    displayName: "Presentations",
    description: "Create, edit, present, and share visual documents.",
    icon: "presentation",
    sortOrder: 20,
    configuration: {
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
            description: "Manage reusable visual systems",
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
    },
  },
  {
    productId: "omnitech.interview",
    displayName: "Interview",
    description: "Create, practise, and organize interview material.",
    icon: "sparkles",
    // The column's default: this row has never named an order.
    sortOrder: 0,
    configuration: {
      enabled: true,
      routePrefix: "/p/interview",
      navigation: {
        group: "Products",
        order: 10,
        hidden: false,
        routes: {
          "interview.home": {
            label: "Interview Studio",
            description: "Prepare, practise and rehearse interviews",
            path: "/p/interview",
            hidden: false,
          },
        },
      },
      featureFlags: {},
      settings: {},
      revision: 1,
    },
  },
];
