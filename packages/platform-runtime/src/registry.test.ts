import type {
  PlatformContext,
  ProductFrontendPlugin,
  ProductManifest,
} from "@omnitech/platform-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DuplicateProductError,
  DuplicateRouteError,
  ProductRegistry,
  ProductUnavailableError,
} from "./registry";

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

const platformContext: PlatformContext = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    displayName: "User",
    avatarUrl: null,
  },
  tenant: {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "acme",
    name: "Acme",
  },
  membership: {
    tenantId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
  },
  preferences: { theme: "system", locale: "en" },
  permissions: ["platform.read"],
  products: [],
};

// INV-0004: a product route resolves membership, then installation, then the
// route's permission; any miss is a 404 before the product's loader runs.
describe("resolvePage", () => {
  const Page = () => null;
  const product = (load = vi.fn(async () => ({ default: Page }))) => ({
    load,
    product: {
      manifest: {
        schemaVersion: 1 as const,
        id: "omnitech.notes",
        version: "1.0.0",
        platformVersion: "^1.0.0",
        defaultName: "Notes",
        defaultDescription: "Notes",
        icon: "notes",
        permissions: ["notes.read"],
        routes: [
          {
            id: "notes.home",
            defaultPath: "/",
            frontendEntry: "home.page",
            requiredPermission: "notes.read",
          },
        ],
        navigation: [],
        configurationSchema: {},
      },
      frontend: { id: "omnitech.notes", routes: { "notes.home": load } },
    },
  });
  const installation = (enabled: boolean) => ({
    productId: "omnitech.notes",
    name: "Notes",
    description: "Notes",
    icon: "notes",
    enabled,
    routePrefix: "/p/notes",
    navigation: { group: "Products", order: 1, hidden: false, routes: {} },
    featureFlags: {},
    settings: {},
    revision: 1,
  });
  const member = (enabled: boolean, permissions: string[]) => ({
    ...platformContext,
    permissions,
    products: [installation(enabled)],
  });
  const request = { tenantSlug: "acme", productId: "notes", path: [] };

  it("serves the route's page to a permitted member", async () => {
    const { load, product: notes } = product();
    const registry = new ProductRegistry();
    registry.register(notes);
    const page = await registry.resolvePage(
      async () => member(true, ["notes.read"]),
      request,
    );
    expect(page.status).toBe(200);
    expect(load).toHaveBeenCalledOnce();
  });

  // The page receives the products the member can switch to, built from the
  // tenant's installations: enabled, not hidden, in navigation order.
  it("links the tenant's visible installed products, marking the current one", async () => {
    const { product: notes } = product();
    const registry = new ProductRegistry();
    registry.register(notes);
    const installed = (
      productId: string,
      order: number,
      overrides: { enabled?: boolean; hidden?: boolean } = {},
    ) => ({
      ...installation(true),
      productId,
      name: productId.split(".")[1]!.toUpperCase(),
      routePrefix: `/p/${productId.split(".")[1]}`,
      enabled: overrides.enabled ?? true,
      navigation: {
        group: "Products",
        order,
        hidden: overrides.hidden ?? false,
        routes: {},
      },
    });
    const page = await registry.resolvePage(
      async () => ({
        ...platformContext,
        permissions: ["notes.read"],
        products: [
          installed("omnitech.zeta", 30),
          installed("omnitech.notes", 20),
          installed("omnitech.alpha", 10),
          installed("omnitech.off", 5, { enabled: false }),
          installed("omnitech.secret", 6, { hidden: true }),
        ],
      }),
      request,
    );
    if (page.status !== 200) throw new Error("expected a page");
    expect(
      page.products.map(({ productId, href, current }) => [
        productId,
        href,
        current,
      ]),
    ).toEqual([
      ["omnitech.alpha", "/t/acme/p/alpha", false],
      ["omnitech.notes", "/t/acme/p/notes", true],
      ["omnitech.zeta", "/t/acme/p/zeta", false],
    ]);
  });

  // A product without a "/" page still has a front door: its root opens its
  // first route, which the member must be permitted like any other.
  it("opens the first route at a product's root when it has no home page", async () => {
    const { load, product: notes } = product();
    const [home] = notes.manifest.routes;
    const registry = new ProductRegistry();
    registry.register({
      ...notes,
      manifest: {
        ...notes.manifest,
        routes: [{ ...home!, id: "notes.library", defaultPath: "/library" }],
      },
      frontend: { id: "omnitech.notes", routes: { "notes.library": load } },
    });
    const page = await registry.resolvePage(
      async () => member(true, ["notes.read"]),
      request,
    );
    expect(page.status).toBe(200);
    if (page.status === 200) expect(page.route.id).toBe("notes.library");
    expect(
      (await registry.resolvePage(async () => member(true, []), request))
        .status,
    ).toBe(404);
  });

  it.each([
    ["a non-member", async () => null],
    [
      "an uninstalled product",
      async () => ({ ...platformContext, permissions: ["notes.read"] }),
    ],
    ["a disabled installation", async () => member(false, ["notes.read"])],
    ["a missing permission", async () => member(true, [])],
  ])(
    "returns 404 for %s before product code loads",
    async (_case, resolveContext) => {
      const { load, product: notes } = product();
      const registry = new ProductRegistry();
      registry.register(notes);
      const page = await registry.resolvePage(resolveContext, request);
      expect(page).toEqual({ status: 404 });
      expect(load).not.toHaveBeenCalled();
    },
  );
});
