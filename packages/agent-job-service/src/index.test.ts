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
    async eventsAfter() {
      return [];
    },
    async requestCancellation() {
      this.cancelled = true;
      return "requested" as const;
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

    await service.cancel("tenant", "user", "job");
    await service.resume("tenant", "user", "job", "prompt:next");

    expect(repository.cancelled).toBe(true);
    expect(repository.resumed).toBe(true);
  });

  it("fails closed for a job the actor cannot see, but counts an ended job as cancelled", async () => {
    const hidden = new AgentJobService({
      ...makeRepository(),
      requestCancellation: async () => "not-found" as const,
    });
    await expect(hidden.cancel("tenant", "user", "missing")).rejects.toThrow(
      "cannot be cancelled",
    );
    const ended = new AgentJobService({
      ...makeRepository(),
      requestCancellation: async () => "already-ended" as const,
    });
    expect(await ended.cancel("tenant", "user", "done")).toBe("already-ended");
  });

  it("hands the actor and the resume guard to the repository", async () => {
    const seen: unknown[] = [];
    const service = new AgentJobService({
      ...makeRepository(),
      async requestResume(tenantId, actorId, jobId, prompt, options) {
        seen.push([tenantId, actorId, jobId, prompt, options?.guard]);
        return true;
      },
    });
    const guard = async () => true;
    await service.resume("t", "u", "j", "p", { guard });
    expect(seen).toEqual([["t", "u", "j", "p", guard]]);
  });

  it("rejects a resume the job cannot take", async () => {
    const service = new AgentJobService({
      ...makeRepository(),
      requestResume: async () => false,
    });
    await expect(
      service.resume("tenant", "user", "job", "prompt:x"),
    ).rejects.toThrow("Agent job was not found or cannot be resumed.");
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
      private: false,
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
      async get(tenantId, _actorId, jobId) {
        return tenantId === job.tenantId && jobId === job.id ? job : undefined;
      },
      async eventsAfter(tenantId, actorId, jobId, sequence) {
        asked.push([tenantId, actorId, jobId, sequence]);
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
    expect(await service.get("tenant-1", "user-1", "job-1")).toBe(job);
    expect(await service.events("tenant-1", "user-1", "job-1", 1)).toEqual([
      event,
    ]);
    expect(await service.events("tenant-1", null, "job-1")).toEqual([event]);
    expect(asked).toEqual([
      ["tenant-1", "user-1", "job-1", 1],
      ["tenant-1", null, "job-1", 0],
    ]);
    // Another tenant cannot read the job's events.
    await expect(service.events("tenant-2", "user-1", "job-1")).rejects.toThrow(
      "Agent job was not found.",
    );
  });
});
