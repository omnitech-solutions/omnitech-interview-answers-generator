import { describe, expect, it } from "vitest";
import { AgentJobService, type AgentJobRepository } from "./index.js";

function makeRepository(): AgentJobRepository & {
  cancelled: boolean;
  resumed: boolean;
} {
  return {
    cancelled: false,
    resumed: false,
    async create() {
      throw new Error("not used");
    },
    async get() {
      return undefined;
    },
    async setResultReference() {},
    async setSessionId() {},
    async claim() {
      return undefined;
    },
    async transition() {
      return true;
    },
    async appendEvent() {
      throw new Error("not used");
    },
    async eventsAfter() {
      return [];
    },
    async requestCancellation() {
      this.cancelled = true;
      return true;
    },
    async requestResume() {
      this.resumed = true;
      return true;
    },
  };
}

describe("agent job service", () => {
  it("delegates cancellation and checkpoint resume", async () => {
    const repository = makeRepository();
    const service = new AgentJobService(repository);

    await service.cancel("tenant", "job");
    await service.resume("tenant", "job", "prompt:next");

    expect(repository.cancelled).toBe(true);
    expect(repository.resumed).toBe(true);
  });

  it("rejects an unavailable cancellation", async () => {
    const service = new AgentJobService({
      ...makeRepository(),
      requestCancellation: async () => false,
    });
    await expect(service.cancel("tenant", "missing")).rejects.toThrow(
      "cannot be cancelled",
    );
  });
});
