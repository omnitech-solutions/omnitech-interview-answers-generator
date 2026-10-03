import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { afterEach, expect, it, vi } from "vitest";

// The pool already exists (another route created it); only the run queue's
// own connection string is missing.
vi.mock("@omnitech/database", () => ({ getPlatformDatabase: () => ({}) }));
const createInterviewBackend = vi.fn(() => ({ app: { fetch: vi.fn() } }));
vi.mock("@omnitech/product-interview/backend", () => ({
  createInterviewBackend,
}));
vi.mock("@omnitech/product-presentation/backend", () => ({
  createPresentationApi: () => ({ fetch: vi.fn() }),
}));
vi.mock("./ai", () => ({
  interviewAssistantBudget: () => ({ contextCharacters: 1 }),
}));
vi.mock("./ai-config", () => ({ resolveDefaultLanguageModel: () => null }));
vi.mock("./context", () => ({ resolvePlatformContext: vi.fn() }));

const { createProductBackends } = await import("./products");

afterEach(() => vi.unstubAllEnvs());

it("refuses to start the interview run queue without DATABASE_URL", () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(() => createProductBackends({} as AiExecutionGateway)).toThrow(
    "DATABASE_URL is required for the interview run queue.",
  );
  expect(createInterviewBackend).not.toHaveBeenCalled();
});

it("gives the run queue the configured connection string", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://app@db/omnitech");
  createProductBackends({} as AiExecutionGateway);
  expect(createInterviewBackend).toHaveBeenCalledWith(
    expect.objectContaining({
      runQueueConnectionString: "postgresql://app@db/omnitech",
    }),
  );
});
