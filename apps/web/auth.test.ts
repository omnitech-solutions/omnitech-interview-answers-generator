import { afterEach, describe, expect, it, vi } from "vitest";

type Authorize = (
  credentials: unknown,
  request?: { headers: Headers },
) => Promise<{ email: string } | null>;
const captured = vi.hoisted(() => ({
  config: undefined as { id: string; authorize: Authorize } | undefined,
}));

vi.mock("next-auth", () => ({
  default: () => ({
    auth: vi.fn(),
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (config: { id: string; authorize: Authorize }) => {
    captured.config = config;
    return config;
  },
}));
vi.mock("next-auth/providers/google", () => ({ default: vi.fn() }));
vi.mock("next-auth/providers/linkedin", () => ({ default: vi.fn() }));
vi.mock("@omnitech/database", () => ({ getPlatformDatabase: vi.fn() }));
vi.mock("@omnitech/platform-storage", () => ({ PlatformRepository: class {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  captured.config = undefined;
});

async function localProvider() {
  vi.stubEnv("FAKE_AUTH_ENABLED", "true");
  await import("./auth");
  if (!captured.config)
    throw new Error("the local provider was not registered");
  return captured.config;
}

describe("the local provider", () => {
  it("is not registered without FAKE_AUTH_ENABLED", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "false");
    await import("./auth");
    expect(captured.config).toBeUndefined();
  });

  it("signs in a loopback request as the local user", async () => {
    const provider = await localProvider();
    const user = await provider.authorize(
      {},
      { headers: new Headers({ host: "localhost:3000" }) },
    );
    expect(user?.email).toBe("local@omnitech.test");
  });

  it("refuses a request for any other host", async () => {
    const provider = await localProvider();
    expect(
      await provider.authorize(
        {},
        { headers: new Headers({ host: "studio.example.com" }) },
      ),
    ).toBeNull();
  });

  it("refuses a request that carries no headers at all", async () => {
    const provider = await localProvider();
    expect(await provider.authorize({}, undefined)).toBeNull();
  });
});

describe("the Auth.js configuration", () => {
  async function configuredWith(env: Record<string, string | undefined>) {
    const configs: Array<{ trustHost: boolean; secret?: string }> = [];
    vi.doMock("next-auth", () => ({
      default: (config: { trustHost: boolean; secret?: string }) => {
        configs.push(config);
        return {
          auth: vi.fn(),
          handlers: {},
          signIn: vi.fn(),
          signOut: vi.fn(),
        };
      },
    }));
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    await import("./auth");
    return configs[0];
  }

  it("does not trust the Host header of a production host by default", async () => {
    const config = await configuredWith({
      NODE_ENV: "production",
      AUTH_SECRET: "x".repeat(32),
      FAKE_AUTH_ENABLED: undefined,
      AUTH_TRUST_HOST: undefined,
    });
    expect(config?.trustHost).toBe(false);
    expect(config?.secret).toBe("x".repeat(32));
  });

  it("signs with no secret (and so refuses requests) on a bare non-production host", async () => {
    const config = await configuredWith({
      NODE_ENV: "development",
      AUTH_SECRET: undefined,
      FAKE_AUTH_ENABLED: undefined,
    });
    expect(config?.secret).toBeUndefined();
  });
});
