import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  resolved: null as PlatformContext | null,
  reads: 0,
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  requestedPath: null as string | null,
}));
vi.mock("next/navigation", () => navigation);
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      navigation.requestedPath
        ? { "x-studio-path": navigation.requestedPath }
        : {},
    ),
}));
// Outside a server render React's `cache` does not dedupe; a per-call-key
// memo stands in for it so the test proves the resolver is wrapped.
vi.mock("react", () => ({
  cache: <Args extends unknown[], Result>(fn: (...args: Args) => Result) => {
    const memo = new Map<string, Result>();
    return (...args: Args) => {
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key) as Result;
    };
  },
}));
vi.mock("@omnitech/database", () => ({ getPlatformDatabase: vi.fn() }));
vi.mock("@omnitech/platform-storage", () => ({
  PlatformRepository: class {
    resolveContext() {
      state.reads += 1;
      return Promise.resolve(state.resolved);
    }
  },
}));

const { refuseTenantAccess, resolvePlatformContext } = await import(
  "./context"
);

afterEach(() => {
  navigation.requestedPath = null;
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

it("reads the membership once when the layout and the page both ask", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { auth } = await import("@/auth");
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { email: "member@example.test" },
  });
  state.reads = 0;
  await Promise.all([
    resolvePlatformContext("acme"),
    resolvePlatformContext("acme"),
  ]);
  expect(state.reads).toBe(1);
});

describe("refuseTenantAccess", () => {
  const signedOut = async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { auth } = await import("@/auth");
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
      null,
    );
  };

  it("sends a signed-out visitor to sign-in, remembering the page asked for", async () => {
    await signedOut();
    await expect(
      refuseTenantAccess("/t/local/p/interview/live"),
    ).rejects.toThrow(
      "redirect:/sign-in?next=%2Ft%2Flocal%2Fp%2Finterview%2Flive",
    );
  });

  it("falls back to the requested path the proxy recorded", async () => {
    await signedOut();
    navigation.requestedPath = "/t/acme/p/interview/rehearsal";
    await expect(refuseTenantAccess()).rejects.toThrow(
      "redirect:/sign-in?next=%2Ft%2Facme%2Fp%2Finterview%2Frehearsal",
    );
  });

  it("never carries an unsafe target into the sign-in URL", async () => {
    await signedOut();
    navigation.requestedPath = "//evil.example";
    await expect(refuseTenantAccess("https://evil.example")).rejects.toThrow(
      "redirect:/sign-in",
    );
    expect(navigation.redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("answers someone signed in who is not a member with a plain 404", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { auth } = await import("@/auth");
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { email: "stranger@example.test" },
    });
    await expect(refuseTenantAccess("/t/acme/p/interview")).rejects.toThrow(
      "not-found",
    );
    expect(navigation.redirect).not.toHaveBeenCalled();
  });
});
