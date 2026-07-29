import type {
  ProductFrontendPlugin,
  ProductManifest,
} from "@omnitech/platform-contracts";
import { describe, expect, it } from "vitest";
import {
  DuplicateProductError,
  DuplicateRouteError,
  ProductRegistry,
  ProductUnavailableError,
} from "./registry.js";

const manifest: ProductManifest = {
  schemaVersion: 1,
  id: "omnitech.interview",
  version: "1.0.0",
  platformVersion: "^1.0.0",
  defaultName: "Interview",
  defaultDescription: "Prepare and practise",
  icon: "code",
  permissions: ["interview.read"],
  routes: [
    {
      id: "interview.workspace",
      defaultPath: "/workspace",
      frontendEntry: "workspace.page",
      requiredPermission: "interview.read",
    },
  ],
  navigation: [],
  configurationSchema: {},
};

const frontend: ProductFrontendPlugin = {
  id: manifest.id,
  routes: {
    "interview.workspace": async () => ({
      default: () => null,
    }),
  },
};

describe("ProductRegistry", () => {
  it("registers and resolves a configured product route", () => {
    const registry = new ProductRegistry();
    registry.register({ manifest, frontend });
    expect(
      registry.resolveRoutes(manifest.id, {
        enabled: true,
        routePrefix: "/interview",
        navigation: {
          group: "Workspaces",
          order: 10,
          hidden: false,
          routes: {},
        },
        featureFlags: {},
        settings: {},
        revision: 1,
      }),
    ).toEqual([
      {
        productId: manifest.id,
        routeId: "interview.workspace",
        path: "/interview/workspace",
        requiredPermission: "interview.read",
      },
    ]);
  });

  it("rejects duplicate products and routes", () => {
    const registry = new ProductRegistry();
    registry.register({ manifest, frontend });
    expect(() => registry.register({ manifest, frontend })).toThrow(
      DuplicateProductError,
    );
    expect(() =>
      registry.register({
        manifest: { ...manifest, id: "omnitech.second" },
        frontend: { ...frontend, id: "omnitech.second" },
      }),
    ).toThrow(DuplicateRouteError);
  });

  it("rejects a disabled installation", () => {
    const registry = new ProductRegistry();
    registry.register({ manifest, frontend });
    expect(() =>
      registry.resolveRoutes(manifest.id, {
        enabled: false,
        routePrefix: "/interview",
        navigation: {
          group: "Workspaces",
          order: 10,
          hidden: false,
          routes: {},
        },
        featureFlags: {},
        settings: {},
        revision: 1,
      }),
    ).toThrow(ProductUnavailableError);
  });
});
