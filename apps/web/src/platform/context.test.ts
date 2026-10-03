import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ resolved: null as PlatformContext | null }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@omnitech/database", () => ({ getPlatformDatabase: vi.fn() }));
vi.mock("@omnitech/platform-storage", () => ({
  PlatformRepository: class {
    resolveContext() {
      return Promise.resolve(state.resolved);
    }
  },
}));

const { resolvePlatformContext } = await import("./context");

afterEach(() => {
  state.resolved = null;
  vi.unstubAllEnvs();
});

it("uses tenant-resolved permissions for local fake sign-in", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("FAKE_AUTH_ENABLED", "true");
  state.resolved = {
    user: {
      id: "00000000-0000-4000-8000-000000000011",
      email: "local@omnitech.test",
      displayName: "Local User",
      avatarUrl: null,
    },
    tenant: {
      id: "00000000-0000-4000-8000-000000000012",
      slug: "local",
      name: "Local Workspace",
    },
    membership: {
      tenantId: "00000000-0000-4000-8000-000000000012",
      userId: "00000000-0000-4000-8000-000000000011",
      role: "owner",
    },
    preferences: { theme: "system", locale: "en" },
    permissions: ["interview.read", "interview.documents.write"],
    products: [],
  };

  const context = await resolvePlatformContext("local");
  expect(context?.permissions).toEqual([
    "interview.read",
    "interview.documents.write",
  ]);
  expect(context?.user.id).toBe(state.resolved.user.id);
  expect(await resolvePlatformContext("other")).toBeNull();
});
