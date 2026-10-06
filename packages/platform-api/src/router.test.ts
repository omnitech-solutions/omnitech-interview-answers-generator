import type { PlatformContext } from "@omnitech/platform-contracts";
import { describe, expect, it, vi } from "vitest";
import { createPlatformApi } from "./router";

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

describe("malformed preferences", () => {
  it("answers 400, not 500, for a body that is not JSON", async () => {
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
        body: "{not json",
      },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_preferences");
    expect(savePreferences).not.toHaveBeenCalled();
  });
});
