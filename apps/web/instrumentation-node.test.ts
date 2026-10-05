// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const runWorker = vi.hoisted(() => vi.fn());
vi.mock("@omnitech/database", () => ({
  getPlatformDatabase: () => ({}),
  roleBypassesRowLevelSecurityMessage: "bypass",
  verifyDatabaseRole: async () => undefined,
}));
vi.mock("./src/platform/ai", () => ({ createPlatformAiGateway: () => ({}) }));
vi.mock("./src/platform/products", () => ({
  createProductBackends: () => [{ runWorker }],
}));

afterEach(() => {
  vi.restoreAllMocks();
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
});
