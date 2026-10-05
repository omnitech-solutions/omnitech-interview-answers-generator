// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
  verifyMigrations.mockImplementation(async () => undefined);
  vi.resetModules();
});

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

  it("refuses to serve on a definite migration mismatch", async () => {
    const { MigrationMismatchError } = await import("@omnitech/database");
    verifyMigrations.mockRejectedValueOnce(
      new (MigrationMismatchError as unknown as new (message: string) => Error)(
        "1 pending",
      ),
    );
    await expect(import("./instrumentation-node")).rejects.toThrow("1 pending");
  });

  it("serves when the database cannot be reached", async () => {
    runWorker.mockResolvedValueOnce(undefined);
    verifyMigrations.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(import("./instrumentation-node")).resolves.toBeDefined();
  });
});
