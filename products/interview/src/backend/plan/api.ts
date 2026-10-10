import {
  interviewPlanInputSchema,
  type PlanItemStatus,
  planItemInputSchema,
  planItemPatchSchema,
} from "@omnitech/interview-contracts";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  WorkspaceError,
  type WorkspaceScope,
} from "../assistant/workspace";
import { BriefingRepository } from "../briefing/repository";
import { InterviewPlanRepository } from "./repository";
import { addItemToCurrentPlan, currentPlan } from "./services/plan.service";

const prefix = "/api/interview/plan";

export { questionStatus } from "./domain/status";

// The plan API: the current interview, its items and each item's live status.
export function createPlanApi(options: {
  database: WorkspaceDatabasePort;
  resolveScope: (request: Request) => Promise<WorkspaceScope | null>;
  // The workspace whose drafts are the person's coding questions.
  questionsWorkspace: string;
  // Origins besides this host's own that may change the plan.
  allowedOrigins?: readonly string[];
  // Status for rehearsal items, when rehearsals are recorded.
  rehearsalStatus?: (
    scope: WorkspaceScope,
    ref: string | null,
  ) => Promise<PlanItemStatus | null>;
}) {
  const app = new Hono<{ Variables: { planScope: WorkspaceScope } }>();
  const plans = new InterviewPlanRepository(options.database);
  const drafts = new InterviewWorkspaceRepository(options.database);
  const briefings = new BriefingRepository(options.database);

  app.use(`${prefix}/*`, async (context, next) => {
    const scope = await options.resolveScope(context.req.raw);
    if (!scope) return context.json({ error: { code: "unauthorized" } }, 401);
    // [SAFETY] Writes come from this host's pages only, never another site.
    if (!["GET", "HEAD"].includes(context.req.method)) {
      const origin = context.req.header("origin");
      const host = context.req.header("host");
      const own = host
        ? new URL(`${new URL(context.req.url).protocol}//${host}`).origin
        : new URL(context.req.url).origin;
      if (
        context.req.header("sec-fetch-site") === "cross-site" ||
        (origin && origin !== own && !options.allowedOrigins?.includes(origin))
      )
        return context.json({ error: { code: "origin-forbidden" } }, 403);
    }
    context.set("planScope", scope);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return context.json({ error: { code: "invalid-request" } }, 400);
    if (error instanceof WorkspaceError && error.code === "not-found")
      return context.json({ error: { code: "not-found" } }, 404);
    throw error;
  });

  const plan = { plans, drafts, briefings, ...options };
  const current = (scope: WorkspaceScope) => currentPlan(plan, scope);

  app.get(prefix, async (context) =>
    context.json(await current(context.get("planScope"))),
  );
  // Create (no id) or update the interview being prepared for.
  app.put(`${prefix}/interview`, async (context) => {
    const scope = context.get("planScope");
    const { id = null, ...input } = (await context.req.json()) as {
      id?: string | null;
    };
    await plans.save(scope, id, interviewPlanInputSchema.parse(input));
    return context.json(await current(scope));
  });
  app.post(`${prefix}/items`, async (context) => {
    const scope = context.get("planScope");
    await addItemToCurrentPlan(plan, scope, async () =>
      planItemInputSchema.parse(await context.req.json()),
    );
    return context.json(await current(scope));
  });
  app.patch(`${prefix}/items/:id`, async (context) => {
    const scope = context.get("planScope");
    await plans.updateItem(
      scope,
      context.req.param("id"),
      planItemPatchSchema.parse(await context.req.json()),
    );
    return context.json(await current(scope));
  });
  app.delete(`${prefix}/items/:id`, async (context) => {
    const scope = context.get("planScope");
    await plans.removeItem(scope, context.req.param("id"));
    return context.json(await current(scope));
  });
  return app;
}
