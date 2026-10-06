// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runWorker = vi.hoisted(() => vi.fn());
const verifyMigrations = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@omnitech/database", () => ({
  getPlatformDatabase: () => ({}),
  MigrationMismatchError: class MigrationMismatchError extends Error {},
  roleBypassesRowLevelSecurityMessage: "bypass",
  verifyDatabaseRole: async () => undefined,
  verifyMigrations,
}));
vi.mock("./src/platform/ai", () => ({ createPlatformAiGateway: () => ({}) }));
vi.mock("./src/platform/products", () => ({
  createProductBackends: () => [{ runWorker }],
}));

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-test-secret-test-secret-12");
});

afterEach(() => {
  vi.restoreAllMocks();
  verifyMigrations.mockImplementation(async () => undefined);
  vi.resetModules();
});

// `next start` only LOGS a throwing startup check and then answers 500 to every
// request forever, which a supervisor that checks "process alive" calls healthy
// (verified by experiment). A fatal condition exits the process instead. Exit
// is stubbed to throw so the import rejects.
function expectRefusal(message: string) {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  return async () => {
    await expect(import("./instrumentation-node")).rejects.toThrow(
      "process.exit",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(logged.mock.calls)).toContain(message);
  };
}

describe("instrumentation-node", () => {
  it("logs a failed worker's class, never its message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    runWorker.mockRejectedValueOnce(
      new TypeError("prompt SECRET-PROMPT-TEXT leaked"),
    );
    await import("./instrumentation-node");
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(JSON.stringify(logged.mock.calls)).toContain("TypeError");
    expect(JSON.stringify(logged.mock.calls)).not.toContain(
      "SECRET-PROMPT-TEXT",
    );
  });

  // AU-SEC-01: at startup, never at build time.
  it("refuses to serve without a session secret", async () => {
    vi.stubEnv("AUTH_SECRET", undefined);
    vi.stubEnv("FAKE_AUTH_ENABLED", undefined);
    await expectRefusal("AUTH_SECRET")();
  });

  it("serves with the local fake sign-in and no configured secret outside production", async () => {
    vi.stubEnv("AUTH_SECRET", undefined);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    runWorker.mockResolvedValueOnce(undefined);
    await expect(import("./instrumentation-node")).resolves.toBeDefined();
  });

  it("refuses to serve on a definite migration mismatch", async () => {
    const { MigrationMismatchError } = await import("@omnitech/database");
    verifyMigrations.mockRejectedValueOnce(
      new (MigrationMismatchError as unknown as new (message: string) => Error)(
        "1 pending",
      ),
    );
    await expectRefusal("1 pending")();
  });

  it("refuses to serve when the database role bypasses row-level security", async () => {
    verifyMigrations.mockRejectedValueOnce(new Error("bypass"));
    await expectRefusal("bypass")();
  });

  it("serves when the database cannot be reached", async () => {
    runWorker.mockResolvedValueOnce(undefined);
    verifyMigrations.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(import("./instrumentation-node")).resolves.toBeDefined();
  });
});
