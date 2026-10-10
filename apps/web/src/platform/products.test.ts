import type { AiEngine } from "@omnitech/ai-engine";
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
  interviewAssistantListing: () => undefined,
  platformPreparedStore: () => ({ store: undefined, kept: "memory" }),
}));
vi.mock("@omnitech/platform-runtime/ai-config", () => ({
  resolveDefaultLanguageModel: () => null,
}));
vi.mock("./context", () => ({ resolvePlatformContext: vi.fn() }));

const { createProductBackends } = await import("./products");

afterEach(() => vi.unstubAllEnvs());

it("refuses to start the interview run queue without DATABASE_URL", () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(() => createProductBackends({} as AiEngine)).toThrow(
    "DATABASE_URL is required for the interview run queue.",
  );
  expect(createInterviewBackend).not.toHaveBeenCalled();
});

it("gives the run queue the configured connection string", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://app@db/omnitech");
  createProductBackends({} as AiEngine);
  expect(createInterviewBackend).toHaveBeenCalledWith(
    expect.objectContaining({
      runQueueConnectionString: "postgresql://app@db/omnitech",
    }),
  );
});

it("passes the configured assistant default to the product", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://app@db/omnitech");
  vi.stubEnv("INTERVIEW_ASSISTANT_DEFAULT_MODEL", "agent/claude-code");
  createProductBackends({} as AiEngine);
  expect(createInterviewBackend).toHaveBeenCalledWith(
    expect.objectContaining({ assistantDefaultModel: "agent/claude-code" }),
  );
});
