import { AgentJobService } from "@omnitech/agent-job-service";
import {
  type AgentProfile,
  validateAgentProfile,
} from "@omnitech/agent-runtime-contracts";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { getPlatformDatabase } from "@omnitech/database";
import { Hono } from "hono";
import { z } from "zod";
import { resolvePlatformContext } from "./context";

const createSchema = z.object({
  productId: z.string().trim().min(1),
  profileId: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(500_000),
});

function profiles(): ReadonlyMap<string, AgentProfile> {
  const values: AgentProfile[] = [
    {
      id: "coding-fast",
      runtime: "codex",
      model: process.env["CODEX_FAST_MODEL"] ?? "gpt-5.3-codex",
      fallbackModels: [],
      effort: "low",
      tools: [],
      sandbox: "read-only",
      approvalPolicy: "never",
      sessionPersistence: false,
      maximumTurns: 1,
      timeoutMs: 120_000,
      maximumOutputBytes: 2_000_000,
      additionalDirectories: [],
      webSearch: false,
    },
    {
      id: "coding-quality",
      runtime: "codex",
      model: process.env["CODEX_QUALITY_MODEL"] ?? "gpt-5.3-codex",
      fallbackModels: [],
      effort: "high",
      tools: ["read"],
      sandbox: "read-only",
      approvalPolicy: "never",
      sessionPersistence: true,
      maximumTurns: 2,
      timeoutMs: 300_000,
      maximumOutputBytes: 4_000_000,
      additionalDirectories: [],
      webSearch: false,
    },
    {
      id: "document-quality",
      runtime: "claude-code",
      model: process.env["CLAUDE_DOCUMENT_MODEL"] ?? "claude-opus-4-6",
      fallbackModels: process.env["CLAUDE_FALLBACK_MODEL"]
        ? [process.env["CLAUDE_FALLBACK_MODEL"]]
        : [],
      effort: "high",
      tools: [],
      sandbox: "read-only",
      approvalPolicy: "never",
      sessionPersistence: false,
      maximumTurns: 2,
      maximumBudgetUsd: 5,
      timeoutMs: 300_000,
      maximumOutputBytes: 4_000_000,
      additionalDirectories: [],
      webSearch: false,
    },
    {
      id: "presentation-editor",
      runtime: "claude-code",
      model: process.env["CLAUDE_DOCUMENT_MODEL"] ?? "claude-opus-4-6",
      fallbackModels: [],
      effort: "high",
      tools: [],
      sandbox: "read-only",
      approvalPolicy: "never",
      sessionPersistence: true,
      maximumTurns: 3,
      maximumBudgetUsd: 8,
      timeoutMs: 300_000,
      maximumOutputBytes: 4_000_000,
      additionalDirectories: [],
      webSearch: false,
      outputSchema: {
        type: "object",
        required: ["sourceXml"],
        properties: { sourceXml: { type: "string" } },
      },
    },
  ];
  return new Map(values.map((profile) => [profile.id, profile]));
}

export function createAgentApi() {
  const api = new Hono();
  const database = getPlatformDatabase();
  const repository = new PostgresAgentJobRepository(database);
  const service = new AgentJobService(repository);
  const payloadSecret =
    process.env["AGENT_PAYLOAD_SECRET"] ??
    process.env["CONNECTED_ACCOUNT_SECRET"];
  const payloads = payloadSecret
    ? new AgentPayloadStore(database, payloadSecret)
    : undefined;

  api.get("/platform/v1/agent-profiles", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    return context.json(
      [...profiles().values()].map((profile) => ({
        id: profile.id,
        runtime: profile.runtime,
        model: profile.model,
        effort: profile.effort,
      })),
    );
  });

  api.post("/platform/v1/agent-jobs", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    if (!payloads) {
      return context.json(
        { error: "AGENT_PAYLOAD_SECRET is not configured." },
        503,
      );
    }
    try {
      const input = createSchema.parse(await context.req.json());
      const profile = profiles().get(input.profileId);
      if (!profile) return context.json({ error: "Unknown profile." }, 400);
      validateAgentProfile(profile);
      const promptReference = await payloads.save(
        platformContext.tenant.id,
        input.prompt,
      );
      const job = await service.create({
        tenantId: platformContext.tenant.id,
        userId: platformContext.user.id,
        productId: input.productId,
        profile,
        promptReference,
      });
      return context.json({ id: job.id, status: job.status }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid agent job request." }, 400);
      }
      return context.json(
        { error: error instanceof Error ? error.message : "Job failed." },
        400,
      );
    }
  });

  api.get("/platform/v1/agent-jobs/:id/events", async (context) => {
    const serviceToken = process.env["AGENT_SERVICE_TOKEN"];
    const internal =
      serviceToken &&
      context.req.header("authorization") === `Bearer ${serviceToken}`;
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = internal
      ? null
      : await resolvePlatformContext(tenantSlug);
    const jobId = context.req.param("id");
    if (!internal && !platformContext) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    if (internal) {
      return context.json(
        await repository.eventsAfter(
          jobId,
          Number(context.req.query("after") ?? "0"),
        ),
      );
    }
    return context.json(
      await service.events(
        platformContext?.tenant.id ?? "",
        jobId,
        Number(context.req.query("after") ?? "0"),
      ),
    );
  });

  api.get("/platform/v1/agent-jobs/:id", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    const job = await service.get(
      platformContext.tenant.id,
      context.req.param("id"),
    );
    if (!job) return context.json({ error: "Agent job was not found." }, 404);
    let result: unknown;
    if (job.resultReference && payloads) {
      try {
        result = JSON.parse(await payloads.load(job.resultReference));
      } catch {
        result = undefined;
      }
    }
    return context.json({
      id: job.id,
      status: job.status,
      ...(job.resultReference && result !== undefined ? { result } : {}),
    });
  });

  api.delete("/platform/v1/agent-jobs/:id", async (context) => {
    const platformContext = await resolvePlatformContext(
      context.req.query("tenant") ?? "",
    );
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    await service.cancel(platformContext.tenant.id, context.req.param("id"));
    return context.body(null, 204);
  });

  api.post("/platform/v1/agent-jobs/:id/resume", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext || !payloads) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    try {
      const input = z
        .object({ prompt: z.string().trim().min(1).max(500_000) })
        .parse(await context.req.json());
      const promptReference = await payloads.save(
        platformContext.tenant.id,
        input.prompt,
      );
      await service.resume(
        platformContext.tenant.id,
        context.req.param("id"),
        promptReference,
      );
      return context.json({ status: "queued" }, 202);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid resume prompt." }, 400);
      }
      return context.json(
        {
          error:
            error instanceof Error ? error.message : "Unable to resume job.",
        },
        409,
      );
    }
  });

  return api;
}
