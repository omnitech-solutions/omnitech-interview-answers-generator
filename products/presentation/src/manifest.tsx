import type {
  ProductFrontendPlugin,
  ProductManifest,
} from "@omnitech/platform-contracts";

export const manifest = {
  schemaVersion: 2,
  id: "omnitech.presentation",
  version: "1.0.0",
  platformVersion: "^1.0.0",
  defaultName: "Presentations",
  defaultDescription: "Create, edit, present, and share visual documents.",
  icon: "presentation",
  // The presentation studio's dark chrome.
  frame: "dark",
  permissions: [
    "presentation.read",
    "presentation.write",
    "presentation.share",
  ],
  routes: [
    {
      id: "presentation.library",
      defaultPath: "/library",
      frontendEntry: "library.page",
      requiredPermission: "presentation.read",
      apiEntries: ["documents"],
    },
    {
      id: "presentation.create",
      defaultPath: "/create",
      frontendEntry: "create.page",
      requiredPermission: "presentation.write",
      apiEntries: ["documents", "generation"],
    },
    {
      id: "presentation.editor",
      defaultPath: "/editor",
      frontendEntry: "editor.page",
      requiredPermission: "presentation.write",
      apiEntries: ["documents", "agent", "export", "sharing"],
    },
    {
      id: "presentation.themes",
      defaultPath: "/themes",
      frontendEntry: "themes.page",
      requiredPermission: "presentation.read",
      apiEntries: ["themes"],
    },
    {
      id: "presentation.shared",
      defaultPath: "/shared",
      frontendEntry: "shared.page",
      requiredPermission: "presentation.share",
      apiEntries: ["sharing"],
      featureFlag: "sharing",
    },
    {
      id: "presentation.present",
      defaultPath: "/present",
      frontendEntry: "present.page",
      requiredPermission: "presentation.read",
      apiEntries: ["documents"],
    },
    {
      id: "presentation.image-studio",
      defaultPath: "/images",
      frontendEntry: "images.page",
      requiredPermission: "presentation.write",
      apiEntries: ["images"],
      featureFlag: "imageStudio",
    },
  ],
  navigation: [
    {
      routeId: "presentation.library",
      defaultLabel: "Presentations",
      defaultDescription: "Browse and manage visual documents",
      group: "Create",
      order: 10,
    },
    {
      routeId: "presentation.create",
      defaultLabel: "Create",
      defaultDescription: "Start a presentation",
      group: "Create",
      order: 20,
    },
    {
      routeId: "presentation.themes",
      defaultLabel: "Themes",
      defaultDescription: "Manage visual systems",
      group: "Design",
      order: 30,
    },
    {
      routeId: "presentation.image-studio",
      defaultLabel: "Image Studio",
      defaultDescription: "Generate and manage images",
      group: "Design",
      order: 40,
    },
  ],
  configurationSchema: {
    type: "object",
    properties: {
      defaultTextProfile: { type: "string" },
      defaultImageProfile: { type: "string" },
      maximumSlides: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  capabilities: [
    "text.structured",
    "text.streaming",
    "image.generate",
    "agent.tools",
  ],
  backgroundJobs: [
    "presentation.generate",
    "presentation.export",
    "presentation.import",
    "presentation.recording",
  ],
  migrationVersion: 2,
  commandPalette: [
    {
      id: "presentation.new",
      routeId: "presentation.create",
      defaultLabel: "New presentation",
    },
    {
      id: "image.new",
      routeId: "presentation.image-studio",
      defaultLabel: "Generate image",
    },
  ],
} as const satisfies ProductManifest;

export const frontendPlugin: ProductFrontendPlugin = {
  id: manifest.id,
  routes: {
    "presentation.library": async () => {
      const { PresentationLibrary } = await import("./frontend/index.js");
      return { default: PresentationLibrary };
    },
    "presentation.create": async () => {
      const { PresentationCreate } = await import("./frontend/index.js");
      return { default: PresentationCreate };
    },
    "presentation.editor": async () => {
      const { PresentationEditor } = await import("./frontend/index.js");
      return { default: PresentationEditor };
    },
    "presentation.themes": async () => {
      const { ThemeLibrary } = await import("./frontend/index.js");
      return { default: ThemeLibrary };
    },
    "presentation.shared": async () => {
      const { SharedPresentation } = await import("./frontend/index.js");
      return { default: SharedPresentation };
    },
    "presentation.present": async () => {
      const { PresentationMode } = await import("./frontend/index.js");
      return { default: PresentationMode };
    },
    "presentation.image-studio": async () => {
      const { ImageStudio } = await import("./frontend/index.js");
      return { default: ImageStudio };
    },
  },
};
