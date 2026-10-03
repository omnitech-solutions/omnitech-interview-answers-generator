import { describe, expect, it } from "vitest";
import {
  type AgentJob,
  AgentJobService,
  type AgentJobRepository,
} from "./index.js";

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

  it("rejects a resume the job cannot take", async () => {
    const service = new AgentJobService({
      ...makeRepository(),
      requestResume: async () => false,
    });
    await expect(service.resume("tenant", "job", "prompt:x")).rejects.toThrow(
      "Agent job was not found or cannot be resumed.",
    );
  });

  it("creates a job and reads it and its events within its tenant", async () => {
    const job = {
      id: "job-1",
      tenantId: "tenant-1",
      userId: "user-1",
      productId: "omnitech.interview",
      status: "queued" as const,
      profile: {} as AgentJob["profile"],
      promptReference: "prompt:1",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const event = {
      jobId: "job-1",
      sequence: 2,
      event: { type: "text-delta" as const, text: "Hi" },
      createdAt: new Date(0),
    };
    const asked: unknown[] = [];
    const service = new AgentJobService({
      ...makeRepository(),
      async create() {
        return job;
      },
      async get(tenantId, jobId) {
        return tenantId === job.tenantId && jobId === job.id ? job : undefined;
      },
      async eventsAfter(jobId, sequence) {
        asked.push([jobId, sequence]);
        return [event];
      },
    });

    expect(
      await service.create({
        tenantId: "tenant-1",
        userId: "user-1",
        productId: "omnitech.interview",
        profile: job.profile,
        promptReference: "prompt:1",
      }),
    ).toBe(job);
    expect(await service.get("tenant-1", "job-1")).toBe(job);
    expect(await service.events("tenant-1", "job-1", 1)).toEqual([event]);
    expect(await service.events("tenant-1", "job-1")).toEqual([event]);
    expect(asked).toEqual([
      ["job-1", 1],
      ["job-1", 0],
    ]);
    // Another tenant cannot read the job's events.
    await expect(service.events("tenant-2", "job-1")).rejects.toThrow(
      "Agent job was not found.",
    );
  });
});
