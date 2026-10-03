import type { PlatformContext } from "@omnitech/platform-contracts";
import { describe, expect, it, vi } from "vitest";
import { createPlatformApi, resolveProductPage } from "./router.js";

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

describe("createPlatformApi", () => {
  it("returns a tenant context", async () => {
    const api = createPlatformApi({
      resolveContext: async () => platformContext,
      savePreferences: async () => undefined,
    });
    const response = await api.request(
      "http://localhost/api/platform/v1/context?tenant=acme",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(platformContext);
  });

  it("validates and saves preferences", async () => {
    const savePreferences = vi.fn();
    const api = createPlatformApi({
      resolveContext: async () => platformContext,
      savePreferences,
    });
    const response = await api.request(
      "http://localhost/api/platform/v1/preferences?tenant=acme",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: "dark", locale: "fr-CA" }),
      },
    );
    expect(response.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith(platformContext, {
      theme: "dark",
      locale: "fr-CA",
    });
  });
});

// INV-0004: a product route resolves membership, then installation, then the
// route's permission; any miss is a 404 before the product's loader runs.
describe("resolveProductPage", () => {
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
    const page = await resolveProductPage(
      {
        resolveContext: async () => member(true, ["notes.read"]),
        products: [notes],
      },
      request,
    );
    expect(page.status).toBe(200);
    expect(load).toHaveBeenCalledOnce();
  });

  it.each([
    ["a non-member", async () => null],
    ["a disabled installation", async () => member(false, ["notes.read"])],
    ["a missing permission", async () => member(true, [])],
  ])(
    "returns 404 for %s before product code loads",
    async (_case, resolveContext) => {
      const { load, product: notes } = product();
      const page = await resolveProductPage(
        { resolveContext, products: [notes] },
        request,
      );
      expect(page).toEqual({ status: 404 });
      expect(load).not.toHaveBeenCalled();
    },
  );
});
