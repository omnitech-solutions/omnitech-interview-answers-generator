// The platform agent-job HTTP routes (profiles, create, events, cancel,
// resume): Hono wiring only. Each resolves the tenant member, validates the
// request and delegates to agent-jobs.ts.
import { readBoundedJson } from "@omnitech/platform-contracts";
import { Hono } from "hono";
import { z } from "zod";
import {
  createAgentJobs,
  jobProfiles,
  mayStartJobFor,
  readJob,
  resumeJob,
  startJob,
} from "./agent-jobs";
import { resolvePlatformContext } from "./context";
import { getProductRegistry } from "./registry";
import { hostSettings } from "./settings";

const createSchema = z.object({
  productId: z.string().trim().min(1),
  profileId: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(500_000),
});

const resumeSchema = z.object({
  prompt: z.string().trim().min(1).max(500_000),
});

// A prompt is at most 500k characters; the body bound leaves room for UTF-8.
const AGENT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

// [SAFETY] Failures are logged as metadata only: the route and the error's
// class, never its message, which can quote the prompt.
function logFailure(route: string, error: unknown) {
  console.error(
    JSON.stringify({
      route,
      error: error instanceof Error ? error.name : "non-error",
    }),
  );
}

async function readAgentBody(request: Request) {
  const body = await readBoundedJson(request, AGENT_BODY_LIMIT_BYTES);
  if (body.ok) return body;
  return body.reason === "too-large"
    ? ({ ok: false, status: 413, error: "The request is too large." } as const)
    : ({ ok: false, status: 400, error: "Invalid request body." } as const);
}

export function createAgentApi() {
  const api = new Hono();
  const jobs = createAgentJobs();
  const { repository, service, payloads } = jobs;

  api.get("/platform/v1/agent-profiles", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    return context.json(
      [...jobProfiles().values()].map((profile) => ({
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
    const body = await readAgentBody(context.req.raw);
    if (!body.ok) return context.json({ error: body.error }, body.status);
    try {
      const input = createSchema.parse(body.value);
      // [SAFETY] Every miss is a 404, before anything is written.
      if (
        !mayStartJobFor(
          platformContext,
          input.productId,
          getProductRegistry().list(),
        )
      ) {
        return context.json({ error: "Not found." }, 404);
      }
      const job = await startJob({ service, payloads }, platformContext, input);
      if (!job) return context.json({ error: "Unknown profile." }, 400);
      return context.json({ id: job.id, status: job.status }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid agent job request." }, 400);
      }
      logFailure("agent-job-create", error);
      return context.json({ error: "Job failed." }, 400);
    }
  });

  api.get("/platform/v1/agent-jobs/:id/events", async (context) => {
    const serviceToken = hostSettings().agentServiceToken;
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
      // [SAFETY] The event gateway names the job's tenant; events are
      // tenant-owned rows, read only inside that tenant.
      const tenantId = context.req.query("tenantId") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
        return context.json({ error: "A tenant id is required." }, 400);
      }
      // [SAFETY] The service token carries no user, so it reads as no actor
      // and sees no private job's events (ADR-0012 Agent jobs). Decision: the
      // gateway does not learn the owner, so session agent jobs (private) are
      // not streamable through the terminal gateway; a permitted-remote
      // session job reaches its owner only through a member's own request.
      return context.json(
        await repository.eventsAfter(
          tenantId,
          null,
          jobId,
          Number(context.req.query("after") ?? "0"),
        ),
      );
    }
    // A job the member cannot see (including another member's private job)
    // is a 404, the same as one that does not exist.
    try {
      return context.json(
        await service.events(
          platformContext?.tenant.id ?? "",
          platformContext?.user.id ?? null,
          jobId,
          Number(context.req.query("after") ?? "0"),
        ),
      );
    } catch {
      return context.json({ error: "Agent job was not found." }, 404);
    }
  });

  api.get("/platform/v1/agent-jobs/:id", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    const job = await readJob(jobs, platformContext, context.req.param("id"));
    if (!job) return context.json({ error: "Agent job was not found." }, 404);
    return context.json(job);
  });

  api.delete("/platform/v1/agent-jobs/:id", async (context) => {
    const platformContext = await resolvePlatformContext(
      context.req.query("tenant") ?? "",
    );
    if (!platformContext) return context.json({ error: "Unauthorized" }, 401);
    // A job the member cannot see (another tenant's, or another member's
    // private job) is a 404, the same as one that does not exist.
    try {
      await service.cancel(
        platformContext.tenant.id,
        platformContext.user.id,
        context.req.param("id"),
      );
    } catch {
      return context.json({ error: "Agent job was not found." }, 404);
    }
    return context.body(null, 204);
  });

  api.post("/platform/v1/agent-jobs/:id/resume", async (context) => {
    const tenantSlug = context.req.query("tenant") ?? "";
    const platformContext = await resolvePlatformContext(tenantSlug);
    if (!platformContext || !payloads) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    const body = await readAgentBody(context.req.raw);
    if (!body.ok) return context.json({ error: body.error }, body.status);
    try {
      const input = resumeSchema.parse(body.value);
      await resumeJob(
        { service, payloads },
        platformContext,
        context.req.param("id"),
        input.prompt,
      );
      return context.json({ status: "queued" }, 202);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return context.json({ error: "Invalid resume prompt." }, 400);
      }
      logFailure("agent-job-resume", error);
      return context.json({ error: "Unable to resume job." }, 409);
    }
  });

  return api;
}
