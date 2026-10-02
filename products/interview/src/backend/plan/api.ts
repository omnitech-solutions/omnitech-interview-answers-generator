import {
  interviewPlanInputSchema,
  type PlanItem,
  type PlanItemStatus,
  type PlanResponse,
  planItemInputSchema,
  planItemPatchSchema,
} from "@omnitech/interview-contracts";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  type DraftSummary,
  InterviewWorkspaceRepository,
  type WorkspaceDatabasePort,
  WorkspaceError,
  type WorkspaceScope,
} from "../assistant/workspace.js";
import { BriefingRepository } from "../briefing/repository.js";
import { InterviewPlanRepository, type StoredPlanItem } from "./repository.js";

const prefix = "/api/interview/plan";

// What a question's latest run says, in the words the plan shows.
export function questionStatus(
  draft: DraftSummary | undefined,
): PlanItemStatus {
  if (!draft) return { label: "Question not found", tone: "warn" };
  const run = draft.lastRun;
  if (!run) return { label: "Tests not run yet", tone: "neutral" };
  if (run.total !== null && run.passed !== null)
    return {
      label: `${run.passed} of ${run.total} tests passing`,
      tone: run.passed === run.total && run.ok ? "good" : "warn",
    };
  return run.ok
    ? { label: "Tests passing", tone: "good" }
    : { label: "Tests failing", tone: "warn" };
}

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

  async function withStatus(
    scope: WorkspaceScope,
    items: StoredPlanItem[],
  ): Promise<PlanItem[]> {
    const needs = (kind: StoredPlanItem["kind"]) =>
      items.some((entry) => entry.kind === kind);
    const [questions, savedBriefings] = await Promise.all([
      needs("question")
        ? drafts.listDrafts(scope, options.questionsWorkspace)
        : [],
      needs("briefing") ? briefings.listArtifacts(scope) : [],
    ]);
    return Promise.all(
      items.map(async (entry): Promise<PlanItem> => {
        let status: PlanItemStatus | null = null;
        if (entry.kind === "question")
          status = questionStatus(
            questions.find((draft) => draft.artifactId === entry.ref),
          );
        else if (entry.kind === "briefing") {
          const briefing = savedBriefings.find((item) => item.id === entry.ref);
          status = !briefing
            ? { label: "Briefing not found", tone: "warn" }
            : briefing.savedRevision > 0
              ? { label: "Saved", tone: "good" }
              : { label: "Draft · not saved yet", tone: "warn" };
        } else if (entry.kind === "rehearsal")
          status = (await options.rehearsalStatus?.(scope, entry.ref)) ?? null;
        return { ...entry, status };
      }),
    );
  }

  async function current(scope: WorkspaceScope): Promise<PlanResponse> {
    const interview = await plans.current(scope);
    return {
      interview,
      items: interview
        ? await withStatus(scope, await plans.items(scope, interview.id))
        : [],
    };
  }

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
    const interview = await plans.current(scope);
    if (!interview) throw new WorkspaceError("not-found");
    await plans.addItem(
      scope,
      interview.id,
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
